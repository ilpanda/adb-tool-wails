package aya

import (
	"adb-tool-wails/adb"
	"adb-tool-wails/util"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"

	pb "adb-tool-wails/aya/proto"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
)

type Client struct {
	param       adb.ExecuteParams
	conn        net.Conn
	localPort   string
	resolves    map[string]chan *pb.Response
	mu          sync.Mutex
	readDone    chan struct{}
	readStarted bool
	closed      bool
}

func NewClient(param adb.ExecuteParams) *Client {
	return &Client{
		param:    param,
		resolves: make(map[string]chan *pb.Response),
		readDone: make(chan struct{}),
	}
}

// isCancelled 检查 context 是否已取消
func (c *Client) isCancelled() bool {
	if c.param.Ctxt == nil {
		return false
	}
	select {
	case <-c.param.Ctxt.Done():
		return true
	default:
		return false
	}
}

// checkCancelled 检查并返回取消错误
func (c *Client) checkCancelled() error {
	if c.isCancelled() {
		return c.param.Ctxt.Err()
	}
	return nil
}

// Connect 连接到 Aya 服务
func (c *Client) Connect(localDexPath string) error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	// 尝试连接，如果失败则启动服务
	if err := c.tryConnect(); err != nil {
		// 优先检查 context 取消
		if err := c.checkCancelled(); err != nil {
			return err
		}

		log.Printf("Initial connection failed, trying to start server: %v", err)

		// Push DEX
		if err := c.pushDex(localDexPath); err != nil {
			return fmt.Errorf("push dex failed: %w", err)
		}

		if err := c.checkCancelled(); err != nil {
			return err
		}

		// 启动服务
		if err := c.startServer(); err != nil {
			return fmt.Errorf("start server failed: %w", err)
		}

		if err := c.checkCancelled(); err != nil {
			return err
		}

		// 等待服务就绪
		if err := c.waitForServer(10 * time.Second); err != nil {
			return fmt.Errorf("wait for server failed: %w", err)
		}

		if err := c.checkCancelled(); err != nil {
			return err
		}

		// 再次尝试连接
		if err := c.tryConnect(); err != nil {
			return fmt.Errorf("connect after start failed: %w", err)
		}
	}

	// 启动读取协程
	c.mu.Lock()
	c.readStarted = true
	c.mu.Unlock()
	go c.readLoop()

	return nil
}

// tryConnect 尝试连接到已运行的服务
func (c *Client) tryConnect() error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	if !c.isRunning() {
		// 再次检查是否是因为取消导致的
		if err := c.checkCancelled(); err != nil {
			return err
		}
		return fmt.Errorf("server not running")
	}

	if err := c.checkCancelled(); err != nil {
		return err
	}

	return c.connectSocket()
}

// isRunning 检查服务是否运行
func (c *Client) isRunning() bool {
	if c.isCancelled() {
		return false
	}

	cmd := adb.BuildAdbShellCmd(c.param.AdbPath, c.param.DeviceId, "cat /proc/net/unix")
	output, err := util.Exec(cmd, true, nil)
	if err != nil {
		return false
	}
	return strings.Contains(output, "@aya")
}

// pushDex 推送 DEX 到设备
func (c *Client) pushDex(localDexPath string) error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	log.Printf("Pushing DEX from %s to device %s", localDexPath, c.param.DeviceId)

	// 创建目录
	mkdirCmd := adb.BuildAdbShellCmd(c.param.AdbPath, c.param.DeviceId, "mkdir -p /data/local/tmp/aya")
	if _, err := util.Exec(mkdirCmd, true, nil); err != nil {
		log.Printf("mkdir warning: %v", err)
	}

	if err := c.checkCancelled(); err != nil {
		return err
	}

	// 推送文件
	pushCmd := adb.BuildAdbCmd(c.param.AdbPath, c.param.DeviceId, fmt.Sprintf("push %s /data/local/tmp/aya/aya.dex", localDexPath))
	if _, err := util.Exec(pushCmd, true, nil); err != nil {
		return fmt.Errorf("push failed: %w", err)
	}

	log.Printf("DEX pushed successfully")
	return nil
}

// startServer 启动服务
func (c *Client) startServer() error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	log.Printf("Starting Aya server on device %s", c.param.DeviceId)

	cmd := adb.BuildAdbShellCmd(c.param.AdbPath, c.param.DeviceId, "CLASSPATH=/data/local/tmp/aya/aya.dex app_process /system/bin io.liriliri.aya.Server &")

	log.Printf("Starting server on device cmd %s", cmd)
	if err := util.ExecBackground(cmd); err != nil {
		return fmt.Errorf("start server failed: %w", err)
	}

	log.Printf("Aya server started")
	return nil
}

// waitForServer 等待服务启动
func (c *Client) waitForServer(timeout time.Duration) error {
	log.Printf("Waiting for Aya server to be ready...")

	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-c.param.Ctxt.Done():
			return c.param.Ctxt.Err()
		case <-ticker.C:
			if time.Now().After(deadline) {
				return fmt.Errorf("server start timeout after %v", timeout)
			}
			if c.isRunning() {
				log.Printf("Aya server is ready")
				return nil
			}
		}
	}
}

// connectSocket 连接 Socket
func (c *Client) connectSocket() error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	log.Printf("Establishing socket connection to device %s", c.param.DeviceId)

	// 1. 建立端口转发
	forwardCmd := adb.BuildAdbCmd(c.param.AdbPath, c.param.DeviceId, "forward tcp:0 localabstract:aya")
	output, err := util.Exec(forwardCmd, true, nil)
	if err != nil {
		return fmt.Errorf("adb forward failed: %w", err)
	}

	// 2. 解析端口号
	c.localPort = strings.TrimSpace(output)
	if c.localPort == "" {
		return fmt.Errorf("failed to get forwarded port")
	}

	log.Printf("ADB forwarded local port: %s", c.localPort)

	if err := c.checkCancelled(); err != nil {
		c.removeForward()
		return err
	}

	// 3. 建立 TCP 连接
	addr := fmt.Sprintf("localhost:%s", c.localPort)
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
	}

	ctx := c.param.Ctxt
	if ctx == nil {
		ctx = context.Background()
	}

	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		c.removeForward()
		return fmt.Errorf("failed to connect to %s: %w", addr, err)
	}

	c.conn = conn
	log.Printf("Socket connection established to %s", addr)

	return nil
}

// removeForward 移除端口转发
func (c *Client) removeForward() {
	if c.localPort != "" {
		cmd := adb.BuildAdbCmd(c.param.AdbPath, c.param.DeviceId, fmt.Sprintf("forward --remove tcp:%s", c.localPort))
		if _, err := util.Exec(cmd, true, nil); err != nil {
			log.Printf("Warning: failed to remove forward: %v", err)
		}
	}
}

// readLoop 读取响应的循环
func (c *Client) readLoop() {
	defer close(c.readDone)

	buf := make([]byte, 0)
	tempBuf := make([]byte, 4096)

	for {
		c.mu.Lock()
		conn := c.conn
		closed := c.closed
		c.mu.Unlock()

		if conn == nil || closed {
			return
		}

		// 设置读取超时，以便能定期检查关闭状态
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))

		n, err := conn.Read(tempBuf)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if err != io.EOF {
				c.mu.Lock()
				if !c.closed {
					log.Printf("Read error: %v", err)
				}
				c.mu.Unlock()
			}
			return
		}

		buf = append(buf, tempBuf[:n]...)

		for len(buf) > 0 {
			length, headerSize := binary.Uvarint(buf)

			if headerSize <= 0 {
				break
			}

			totalSize := headerSize + int(length)

			if len(buf) < totalSize {
				break
			}

			msgData := buf[headerSize:totalSize]
			buf = buf[totalSize:]

			resp := &pb.Response{}
			if err := proto.Unmarshal(msgData, resp); err != nil {
				log.Printf("Failed to unmarshal response: %v", err)
				continue
			}

			c.mu.Lock()
			if ch, ok := c.resolves[resp.Id]; ok {
				ch <- resp
				delete(c.resolves, resp.Id)
			}
			c.mu.Unlock()
		}
	}
}

// SendMessage 发送消息并接收响应
func (c *Client) SendMessage(method string, params interface{}) (map[string]interface{}, error) {
	c.mu.Lock()
	conn := c.conn
	closed := c.closed
	c.mu.Unlock()

	if conn == nil || closed {
		return nil, fmt.Errorf("not connected")
	}

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal params: %w", err)
	}

	id := uuid.New().String()
	req := &pb.Request{
		Id:     id,
		Method: method,
		Params: string(paramsJSON),
	}

	log.Printf("Sending request: method=%s, id=%s", method, id)

	respCh := make(chan *pb.Response, 1)
	c.mu.Lock()
	c.resolves[id] = respCh
	c.mu.Unlock()

	reqData, err := proto.Marshal(req)
	if err != nil {
		c.mu.Lock()
		delete(c.resolves, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	lenBuf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(lenBuf, uint64(len(reqData)))
	buf := append(lenBuf[:n], reqData...)

	if _, err := conn.Write(buf); err != nil {
		c.mu.Lock()
		delete(c.resolves, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to write request: %w", err)
	}

	ctx := c.param.Ctxt
	if ctx == nil {
		ctx = context.Background()
	}

	select {
	case resp := <-respCh:
		log.Printf("Received response: id=%s", resp.Id)

		var result map[string]interface{}
		if err := json.Unmarshal([]byte(resp.Result), &result); err != nil {
			return nil, fmt.Errorf("failed to unmarshal result: %w, raw: %s", err, resp.Result)
		}

		return result, nil

	case <-time.After(30 * time.Second):
		c.mu.Lock()
		delete(c.resolves, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("request timeout")

	case <-ctx.Done():
		c.mu.Lock()
		delete(c.resolves, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Close 关闭连接
func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	conn := c.conn
	readStarted := c.readStarted
	c.mu.Unlock()

	log.Printf("Closing Aya client connection")

	var err error

	if conn != nil {
		if closeErr := conn.Close(); closeErr != nil {
			log.Printf("Error closing connection: %v", closeErr)
			err = closeErr
		}
	}

	// 只有 readLoop 启动了才等待
	if readStarted {
		select {
		case <-c.readDone:
		case <-time.After(2 * time.Second):
			log.Printf("Warning: readLoop did not finish in time")
		}
	}

	c.mu.Lock()
	for id, ch := range c.resolves {
		close(ch)
		delete(c.resolves, id)
	}
	c.conn = nil
	c.mu.Unlock()

	if c.localPort != "" {
		c.removeForward()
		c.localPort = ""
	}

	return err
}

// GetPackageInfo 获取单个应用的详细信息
func (c *Client) GetPackageInfo(packageName string) (*PackageInfo, error) {
	params := map[string]interface{}{
		"packageName": packageName,
	}
	result, err := c.SendMessage("getPackageInfo", params)
	if err != nil {
		return nil, err
	}

	info := &PackageInfo{
		PackageName: packageName,
	}

	if label, ok := result["label"].(string); ok {
		info.Label = label
	}
	if icon, ok := result["icon"].(string); ok {
		info.Icon = icon
	}
	if versionName, ok := result["versionName"].(string); ok {
		info.VersionName = versionName
	}
	if versionCode, ok := result["versionCode"].(float64); ok {
		info.VersionCode = int(versionCode)
	}
	if firstInstall, ok := result["firstInstallTime"].(float64); ok {
		info.FirstInstallTime = int64(firstInstall)
	}
	if lastUpdate, ok := result["lastUpdateTime"].(float64); ok {
		info.LastUpdateTime = int64(lastUpdate)
	}
	if apkPath, ok := result["apkPath"].(string); ok {
		info.ApkPath = apkPath
	}
	if apkSize, ok := result["apkSize"].(float64); ok {
		info.ApkSize = int64(apkSize)
	}
	if appSize, ok := result["appSize"].(float64); ok {
		info.AppSize = int64(appSize)
	}
	if dataSize, ok := result["dataSize"].(float64); ok {
		info.DataSize = int64(dataSize)
	}
	if cacheSize, ok := result["cacheSize"].(float64); ok {
		info.CacheSize = int64(cacheSize)
	}
	if enabled, ok := result["enabled"].(bool); ok {
		info.Enabled = enabled
	}
	if system, ok := result["system"].(bool); ok {
		info.System = system
	}
	if minSdk, ok := result["minSdkVersion"].(float64); ok {
		info.MinSdkVersion = int(minSdk)
	}
	if targetSdk, ok := result["targetSdkVersion"].(float64); ok {
		info.TargetSdkVersion = int(targetSdk)
	}
	if sigs, ok := result["signatures"].([]interface{}); ok {
		info.Signatures = make([]string, 0, len(sigs))
		for _, sig := range sigs {
			if sigStr, ok := sig.(string); ok {
				info.Signatures = append(info.Signatures, sigStr)
			}
		}
	}

	if info.Label == "" {
		info.Label = packageName
	}

	return info, nil
}

// GetPackageInfos 批量获取应用信息
func (c *Client) GetPackageInfos(packageNames []string) ([]PackageInfo, error) {
	params := map[string]interface{}{
		"packageNames": packageNames,
	}

	result, err := c.SendMessage("getPackageInfos", params)
	if err != nil {
		return nil, fmt.Errorf("send message failed: %w", err)
	}

	packageInfosRaw, ok := result["packageInfos"]
	if !ok {
		return nil, fmt.Errorf("missing packageInfos field in response")
	}

	jsonBytes, err := json.Marshal(packageInfosRaw)
	if err != nil {
		return nil, fmt.Errorf("marshal failed: %w", err)
	}

	var packageInfos []PackageInfo
	if err := json.Unmarshal(jsonBytes, &packageInfos); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return packageInfos, nil
}
