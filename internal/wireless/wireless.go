package wireless

import (
	"adb-tool-wails/internal/util"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Package wireless 无线调试：配对（Android 11+）、连接、USB 转无线（adb tcpip）、断开。
// 参考 aya 的实现，另外在配对后通过 mDNS 自动找到连接端口，并支持 Android Studio 同款的二维码配对

// MdnsService adb mdns services 中的一项
type MdnsService struct {
	Name    string `json:"name"`
	Type    string `json:"type"`    // _adb-tls-pairing._tcp / _adb-tls-connect._tcp / _adb._tcp
	Address string `json:"address"` // ip:port
}

// Result 无线调试操作结果
type Result struct {
	Cmd       string `json:"cmd"`
	Output    string `json:"output"`
	Connected string `json:"connected"` // 已连接的地址（ip:port），未连接为空
	Paired    bool   `json:"paired"`    // 配对成功（可能还没有连接）
	Host      string `json:"host"`      // 配对设备的 IP，用于提示用户补充连接端口
	Error     string `json:"error,omitempty"`
}

const (
	mdnsPairingType = "_adb-tls-pairing._tcp"
	mdnsConnectType = "_adb-tls-connect._tcp"
	tcpipPort       = "5555"
)

var (
	reHostPort  = regexp.MustCompile(`^[A-Za-z0-9.\-:\[\]]+$`)
	reWlanIP    = regexp.MustCompile(`inet (\d+\.\d+\.\d+\.\d+)/`)
	rePairCode  = regexp.MustCompile(`^\d{6}$`)
	reMdnsEntry = regexp.MustCompile(`^(\S+)\s+(_adb[\w.-]*\._tcp)\.?\s+(\S+:\d+)$`)
)

func runAdbArgs(ctx context.Context, adbPath string, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, adbPath, args...)
	util.ConfigureCommand(cmd)
	output, err := cmd.CombinedOutput()
	cmdLine := util.QuoteHostArg(adbPath) + " " + strings.Join(args, " ")
	return strings.TrimSpace(string(output)), cmdLine, err
}

// Connect adb connect host[:port]；未写端口时 adb 默认 5555
func Connect(adbPath, address string) Result {
	address = strings.TrimSpace(address)
	if address == "" || !reHostPort.MatchString(address) {
		return Result{Error: "地址格式不正确，例如 192.168.1.5:5555"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, cmdLine, err := runAdbArgs(ctx, adbPath, "connect", address)
	result := Result{Cmd: cmdLine, Output: output}
	// adb connect 失败时退出码也可能是 0，以输出判断
	lower := strings.ToLower(output)
	switch {
	case strings.Contains(lower, "connected to"):
		result.Connected = strings.TrimSpace(output[strings.LastIndex(lower, "connected to")+len("connected to"):])
	case ctx.Err() != nil:
		result.Error = "连接超时，请确认手机与电脑在同一网络，并且无线调试已开启"
	case output != "":
		result.Error = output
	case err != nil:
		result.Error = err.Error()
	default:
		result.Error = "连接失败"
	}
	return result
}

// Pair adb pair host:port code；配对成功后尝试通过 mDNS 找到该设备的连接端口并自动连接
func Pair(adbPath, address, code string) Result {
	address = strings.TrimSpace(address)
	code = strings.TrimSpace(code)
	if !reHostPort.MatchString(address) || !strings.Contains(address, ":") {
		return Result{Error: "请填写配对地址，格式为 IP:端口，例如 192.168.1.5:37123"}
	}
	if !rePairCode.MatchString(code) {
		return Result{Error: "配对码为 6 位数字"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	output, cmdLine, err := runAdbArgs(ctx, adbPath, "pair", address, code)
	result := Result{Cmd: cmdLine, Output: output}
	if !strings.Contains(output, "Successfully paired") {
		switch {
		case ctx.Err() != nil:
			result.Error = "配对超时，请确认配对码弹窗仍在手机上显示"
		case output != "":
			result.Error = output
		case err != nil:
			result.Error = err.Error()
		default:
			result.Error = "配对失败"
		}
		return result
	}

	host := address[:strings.LastIndex(address, ":")]
	result.Paired = true
	result.Host = host
	// 连接端口与配对端口不同：先用 mDNS 找；电脑与手机不在同一网段（公司网络常见）时 mDNS 发现不了，
	// 再看这台手机是否同时通过 USB 连接，直接读它当前的无线调试端口
	connectAddr := waitMdnsService(adbPath, mdnsConnectType, func(s MdnsService) bool {
		return strings.HasPrefix(s.Address, host+":")
	}, 4*time.Second)
	candidates := connectAddressesViaUSB(adbPath, host)
	if connectAddr != "" {
		candidates = append([]string{connectAddr}, candidates...)
	}
	for _, candidate := range candidates {
		connected := Connect(adbPath, candidate)
		result.Output += "\n" + connected.Output
		if connected.Connected != "" {
			result.Connected = connected.Connected
			break
		}
	}
	return result
}

// connectAddressesViaUSB 在 USB 连接的设备中找到 WLAN IP 为 host 的那台，返回它可能的无线调试连接地址。
// 优先读 service.adb.tls.port；部分 ROM（如 ColorOS / Android 16）不设置该属性，
// 再从 /proc/net/tcp{,6} 中取 adbd（uid 2000）监听的端口作为候选
func connectAddressesViaUSB(adbPath, host string) []string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, _, err := runAdbArgs(ctx, adbPath, "devices")
	if err != nil {
		return nil
	}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[1] != "device" || strings.Contains(fields[0], ":") || strings.Contains(fields[0], "._adb-tls") {
			continue
		}
		info, _, err := runAdbArgs(ctx, adbPath, "-s", fields[0], "shell",
			"ip -f inet addr show wlan0; echo '##PROP'; getprop service.adb.tls.port; echo '##NET'; cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null")
		if err != nil {
			continue
		}
		if match := reWlanIP.FindStringSubmatch(info); match == nil || match[1] != host {
			continue
		}
		var addresses []string
		for _, port := range adbdPortCandidates(info) {
			addresses = append(addresses, host+":"+port)
		}
		return addresses
	}
	return nil
}

// adbdPortCandidates 解析 connectAddressesViaUSB 的输出，属性中的端口排在最前
func adbdPortCandidates(info string) []string {
	var ports []string
	seen := map[string]bool{}
	add := func(port string) {
		if port != "" && port != "0" && !seen[port] {
			seen[port] = true
			ports = append(ports, port)
		}
	}
	section := ""
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "##") {
			section = line
			continue
		}
		switch section {
		case "##PROP":
			if _, err := strconv.Atoi(line); err == nil {
				add(line)
			}
		case "##NET":
			// sl local_address rem_address st ... uid：只看监听（0A）在所有地址上、属于 shell（2000）的套接字
			fields := strings.Fields(line)
			if len(fields) < 8 || fields[3] != "0A" || fields[7] != "2000" {
				continue
			}
			addrPort := strings.SplitN(fields[1], ":", 2)
			if len(addrPort) != 2 || strings.Trim(addrPort[0], "0") != "" {
				continue
			}
			if port, err := strconv.ParseInt(addrPort[1], 16, 32); err == nil {
				add(strconv.FormatInt(port, 10))
			}
		}
	}
	return ports
}

// PairByQR 等待手机扫码：手机扫码后会以二维码中的服务名广播配对服务，找到后用二维码中的密码配对
func PairByQR(ctx context.Context, adbPath, serviceName, password string) Result {
	var pairAddr string
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for pairAddr == "" {
		for _, service := range MdnsServices(adbPath) {
			if service.Type == mdnsPairingType && service.Name == serviceName {
				pairAddr = service.Address
			}
		}
		if pairAddr != "" {
			break
		}
		select {
		case <-ctx.Done():
			if ctx.Err() == context.DeadlineExceeded {
				return Result{Error: "等待扫码超时，请重新生成二维码"}
			}
			return Result{Error: "已取消"}
		case <-ticker.C:
		}
	}
	return Pair(adbPath, pairAddr, password)
}

// Disconnect adb disconnect serial
func Disconnect(adbPath, serial string) Result {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, cmdLine, err := runAdbArgs(ctx, adbPath, "disconnect", serial)
	result := Result{Cmd: cmdLine, Output: output}
	if err != nil || strings.Contains(strings.ToLower(output), "error") {
		result.Error = output
		if result.Error == "" {
			result.Error = err.Error()
		}
	}
	return result
}

// FromUSB 让 USB 连接的设备监听 5555 端口并通过 WLAN 连接（适用于 Android 10 及以下，或未开启无线调试）
func FromUSB(adbPath, deviceId string) Result {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ipOutput, _, _ := runAdbArgs(ctx, adbPath, "-s", deviceId, "shell", "ip -f inet addr show wlan0")
	match := reWlanIP.FindStringSubmatch(ipOutput)
	if match == nil {
		return Result{Error: "未获取到手机的 WLAN IP，请确认手机已连接 Wi-Fi"}
	}
	ip := match[1]

	output, cmdLine, err := runAdbArgs(ctx, adbPath, "-s", deviceId, "tcpip", tcpipPort)
	if err != nil {
		return Result{Cmd: cmdLine, Output: output, Error: "切换到无线模式失败：" + output}
	}
	// adbd 重启需要时间；部分 adb 版本（如 macOS 上的 34.0.5）在设备 USB 重新枚举时 server 会崩溃重启，
	// 连接可能失败一两次，多试几次
	var result Result
	for attempt := 0; attempt < 4; attempt++ {
		time.Sleep(2 * time.Second)
		result = Connect(adbPath, ip+":"+tcpipPort)
		if result.Connected != "" {
			break
		}
	}
	result.Cmd = cmdLine + "\n" + result.Cmd
	result.Output = output + "\n" + result.Output
	return result
}

// MdnsServices adb mdns services，adb 版本过低或不支持时返回空
func MdnsServices(adbPath string) []MdnsService {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, _, err := runAdbArgs(ctx, adbPath, "mdns", "services")
	if err != nil {
		return nil
	}
	return parseMdnsServices(output)
}

func parseMdnsServices(output string) []MdnsService {
	var services []MdnsService
	for _, line := range strings.Split(output, "\n") {
		if m := reMdnsEntry.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			services = append(services, MdnsService{Name: m[1], Type: strings.TrimSuffix(m[2], "."), Address: m[3]})
		}
	}
	return services
}

func waitMdnsService(adbPath, serviceType string, match func(MdnsService) bool, timeout time.Duration) string {
	deadline := time.Now().Add(timeout)
	for {
		for _, service := range MdnsServices(adbPath) {
			if service.Type == serviceType && match(service) {
				return service.Address
			}
		}
		if time.Now().After(deadline) {
			return ""
		}
		time.Sleep(time.Second)
	}
}

// MdnsSupported adb 是否支持 mDNS（二维码配对、配对后自动连接都依赖它）
func MdnsSupported(adbPath string) (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, _, err := runAdbArgs(ctx, adbPath, "mdns", "check")
	if err != nil {
		return false, fmt.Sprintf("当前 adb 不支持 mDNS：%s", output)
	}
	return strings.Contains(output, "mdns daemon version"), output
}
