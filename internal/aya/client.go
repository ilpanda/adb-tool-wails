package aya

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/util"
	"bytes"
	"context"
	"crypto/md5"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	pb "adb-tool-wails/internal/aya/proto"

	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
)

// AyaDexVersion 当前 aya.dex 的版本号，需要与 server/build.gradle 中的 versionName 保持一致
const AyaDexVersion = "1.7"

type Client struct {
	param       adb.ExecuteParams
	conn        io.ReadWriteCloser
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

const (
	remoteDexPath = "/data/local/tmp/aya/aya.dex"
	// [r] 让模式不匹配执行这条命令的 shell 自身（它的命令行里也含有这个字符串）
	serverPattern = "'io.liriliri.aya.Serve[r]'"
	// 版本握手的超时：服务未运行时 adb 会立即断开转发的连接，不必等满
	versionTimeout = 3 * time.Second
	requestTimeout = 30 * time.Second
)

// Connect 连接到 Aya 服务：设备上已有同版本的服务时直接复用，否则重新部署
func (c *Client) Connect(localDexPath string) error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	// 直接连接并握手，不先用 adb shell 检查服务是否在运行
	if err := c.connectSocket(); err == nil {
		c.startReadLoop()
		remoteVersion, err := c.getRemoteVersion()
		switch {
		case err != nil:
			applog.Infof(applog.CategoryAya, "server_unavailable device=%s err=%q", c.param.DeviceId, err.Error())
		case remoteVersion == AyaDexVersion:
			applog.Infof(applog.CategoryAya, "server_reused device=%s version=%s", c.param.DeviceId, remoteVersion)
			return nil
		default:
			applog.Warnf(applog.CategoryAya, "server_version_mismatch device=%s remote=%s local=%s", c.param.DeviceId, remoteVersion, AyaDexVersion)
		}
		c.Close()
	}

	if err := c.checkCancelled(); err != nil {
		return err
	}
	if err := c.deploy(localDexPath); err != nil {
		return err
	}
	if err := c.checkCancelled(); err != nil {
		return err
	}
	if err := c.connectSocket(); err != nil {
		return fmt.Errorf("connect failed: %w", err)
	}
	c.startReadLoop()
	return nil
}

func (c *Client) startReadLoop() {
	c.mu.Lock()
	c.readStarted = true
	c.mu.Unlock()
	go c.readLoop()
}

// getRemoteVersion 获取远端服务版本号
func (c *Client) getRemoteVersion() (string, error) {
	result, err := c.sendMessage("getVersion", nil, versionTimeout)
	if err != nil {
		return "", err
	}

	version, ok := result["version"].(string)
	if !ok {
		return "", fmt.Errorf("invalid version response")
	}

	return version, nil
}

// deploy 结束旧服务，设备上的 dex 与本地不同时才推送，然后启动服务并在设备端等待其就绪
func (c *Client) deploy(localDexPath string) error {
	localMD5, err := fileMD5(localDexPath)
	if err != nil {
		return fmt.Errorf("read dex failed: %w", err)
	}

	// 一次 adb shell 完成：结束旧服务、读取设备上 dex 的 md5
	out, _ := c.runAdb(10*time.Second, "shell", fmt.Sprintf("pkill -f %s; md5sum %s 2>/dev/null", serverPattern, remoteDexPath))
	if err := c.checkCancelled(); err != nil {
		return err
	}
	if fields := strings.Fields(out); len(fields) > 0 && fields[0] == localMD5 {
		applog.Infof(applog.CategoryAya, "dex_push_skipped device=%s md5=%s", c.param.DeviceId, localMD5)
	} else {
		applog.Infof(applog.CategoryAya, "dex_push_started device=%s path=%s", c.param.DeviceId, localDexPath)
		// adb push 会自动创建设备上缺失的目录
		if _, err := c.runAdb(60*time.Second, "push", localDexPath, remoteDexPath); err != nil {
			return fmt.Errorf("push dex failed: %w", err)
		}
		applog.Infof(applog.CategoryAya, "dex_push_completed device=%s", c.param.DeviceId)
	}
	if err := c.checkCancelled(); err != nil {
		return err
	}

	// 先等旧进程退出（否则新服务绑定 @aya 会失败），再后台启动服务，最后等 @aya 出现。
	// 主类名拆成 $p.Server 拼接，脚本自身的命令行里就不含完整类名，pgrep 不会匹配到这个 shell。
	// 输出已重定向，adb shell 在脚本结束时即返回，不会被后台服务挂住
	script := fmt.Sprintf(
		"p=io.liriliri.aya; i=0; while [ $i -lt 40 ] && pgrep -f %[1]s >/dev/null; do sleep 0.05; i=$((i+1)); done; "+
			"CLASSPATH=%[2]s nohup app_process /system/bin $p.Server >/dev/null 2>&1 & "+
			"i=0; while [ $i -lt 200 ]; do grep -q '@aya$' /proc/net/unix && echo ready && exit 0; sleep 0.05; i=$((i+1)); done; echo timeout",
		serverPattern, remoteDexPath)
	applog.Infof(applog.CategoryAya, "server_start_requested device=%s", c.param.DeviceId)
	out, err = c.runAdb(20*time.Second, "shell", script)
	if err := c.checkCancelled(); err != nil {
		return err
	}
	if err != nil {
		return fmt.Errorf("start server failed: %w", err)
	}
	if strings.TrimSpace(out) != "ready" {
		return fmt.Errorf("start server failed: server not ready after 10s")
	}
	applog.Infof(applog.CategoryAya, "server_ready device=%s", c.param.DeviceId)
	return nil
}

// runAdb 以参数列表直接执行 adb（不经过本机 shell），返回标准输出
func (c *Client) runAdb(timeout time.Duration, args ...string) (string, error) {
	parent := c.param.Ctxt
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	adbPath := c.param.AdbPath
	if adbPath == "" {
		adbPath = "adb"
	}
	cmd := exec.CommandContext(ctx, adbPath, c.param.Args(args...)...)
	util.ConfigureCommand(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return string(out), ctx.Err()
		}
		return string(out), fmt.Errorf("%w %s", err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

func fileMD5(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := md5.Sum(data)
	return hex.EncodeToString(sum[:]), nil
}

// connectSocket 连接 Socket
func (c *Client) connectSocket() error {
	if err := c.checkCancelled(); err != nil {
		return err
	}

	applog.Infof(applog.CategoryAya, "socket_connect_started device=%s", c.param.DeviceId)

	// 1. 建立端口转发
	forwardCmd := adb.Command(c.param.AdbPath, c.param.DeviceId, "forward tcp:0 localabstract:aya")
	output, err := util.Exec(forwardCmd, true, nil)
	if err != nil {
		return fmt.Errorf("adb forward failed: %w", err)
	}

	// 2. 解析端口号
	c.localPort = strings.TrimSpace(output)
	if c.localPort == "" {
		return fmt.Errorf("failed to get forwarded port")
	}

	applog.Infof(applog.CategoryAya, "adb_forward_created device=%s local_port=%s", c.param.DeviceId, c.localPort)

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
	applog.Infof(applog.CategoryAya, "socket_connected device=%s addr=%s", c.param.DeviceId, addr)

	return nil
}

// removeForward 移除端口转发
func (c *Client) removeForward() {
	if c.localPort != "" {
		cmd := adb.Command(c.param.AdbPath, c.param.DeviceId, fmt.Sprintf("forward --remove tcp:%s", c.localPort))
		if _, err := util.Exec(cmd, true, nil); err != nil {
			applog.Warnf(applog.CategoryAya, "adb_forward_remove_failed device=%s local_port=%s err=%q", c.param.DeviceId, c.localPort, err.Error())
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
		if socket, ok := conn.(net.Conn); ok {
			socket.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		}

		n, err := conn.Read(tempBuf)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			if err != io.EOF {
				c.mu.Lock()
				if !c.closed {
					applog.Warnf(applog.CategoryAya, "socket_read_failed device=%s err=%q", c.param.DeviceId, err.Error())
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
				applog.Warnf(applog.CategoryAya, "response_unmarshal_failed device=%s err=%q", c.param.DeviceId, err.Error())
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
	return c.sendMessage(method, params, requestTimeout)
}

func (c *Client) sendMessage(method string, params interface{}, timeout time.Duration) (map[string]interface{}, error) {
	c.mu.Lock()
	conn := c.conn
	closed := c.closed
	readDone := c.readDone
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

	if method != "nextClipboardChange" {
		applog.Infof(applog.CategoryAya, "request_sent device=%s method=%s id=%s", c.param.DeviceId, method, id)
	}

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

	var resp *pb.Response
	select {
	case resp = <-respCh:
	case <-readDone:
		// 连接已断开；断开前可能刚好收到了响应
		select {
		case resp = <-respCh:
		default:
		}
	case <-time.After(timeout):
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
	if resp == nil {
		// 连接断开（Close 会关闭等待中的 channel）
		c.mu.Lock()
		delete(c.resolves, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("connection closed")
	}

	if method != "nextClipboardChange" {
		applog.Infof(applog.CategoryAya, "response_received device=%s id=%s", c.param.DeviceId, resp.Id)
	}

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resp.Result), &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal result: %w", err)
	}
	return result, nil
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

	applog.Infof(applog.CategoryAya, "client_closing device=%s", c.param.DeviceId)

	var err error

	if conn != nil {
		if closeErr := conn.Close(); closeErr != nil {
			applog.Warnf(applog.CategoryAya, "client_close_failed device=%s err=%q", c.param.DeviceId, closeErr.Error())
			err = closeErr
		}
	}

	// 只有 readLoop 启动了才等待
	if readStarted {
		select {
		case <-c.readDone:
		case <-time.After(2 * time.Second):
			applog.Warnf(applog.CategoryAya, "read_loop_close_timeout device=%s", c.param.DeviceId)
		}
	}

	c.mu.Lock()
	for id, ch := range c.resolves {
		close(ch)
		delete(c.resolves, id)
	}
	c.conn = nil
	// 重置状态以支持重连
	c.closed = false
	c.readStarted = false
	c.readDone = make(chan struct{})
	c.mu.Unlock()

	if c.localPort != "" {
		c.removeForward()
		c.localPort = ""
	}

	return err
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
