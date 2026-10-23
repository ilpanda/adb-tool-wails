package perf

import (
	"regexp"
	"strconv"
	"strings"
)

var reFirstNumber = regexp.MustCompile(`:\s*([\d,]+)`)

// MemInfo 内存信息结构体（带时间戳）
type MemInfo struct {
	Timestamp    int64  `json:"timestamp"`
	JavaHeap     int64  `json:"javaHeap"`
	NativeHeap   int64  `json:"nativeHeap"`
	Code         int64  `json:"code"`
	Stack        int64  `json:"stack"`
	Graphics     int64  `json:"graphics"`
	PrivateOther int64  `json:"privateOther"`
	System       int64  `json:"system"`
	Unknown      int64  `json:"unknown"`
	TotalPSS     int64  `json:"totalPss"`
	RawMemInfo   string `json:"rawMemInfo"`
}

// ParseMemInfo 解析 dumpsys meminfo 输出
func ParseMemInfo(output string) MemInfo {
	memInfo := MemInfo{}
	lines := strings.Split(output, "\n")

	// 用于匹配 App Summary 部分的数据
	// 格式示例:
	//  App Summary
	//                        Pss(KB)                        Rss(KB)
	//                         ------                         ------
	//            Java Heap:    12345                          23456
	//          Native Heap:    23456                          34567
	//                 Code:     3456                           4567
	//                Stack:      234                            345
	//             Graphics:    45678                          56789
	//        Private Other:     1234                           2345
	//               System:     2345
	//              Unknown:      567
	//
	//            TOTAL PSS:    89012                         123456

	inAppSummary := false

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)

		// 检测进入 App Summary 部分
		if strings.Contains(trimmedLine, "App Summary") {
			inAppSummary = true
			continue
		}

		// 如果遇到空行或其他部分，且已经在 App Summary 中，检查是否结束
		if inAppSummary {
			// 解析各个内存区域
			if strings.HasPrefix(trimmedLine, "Java Heap:") {
				memInfo.JavaHeap = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Native Heap:") {
				memInfo.NativeHeap = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Code:") {
				memInfo.Code = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Stack:") {
				memInfo.Stack = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Graphics:") {
				memInfo.Graphics = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Private Other:") {
				memInfo.PrivateOther = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "System:") {
				memInfo.System = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Unknown:") {
				memInfo.Unknown = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "TOTAL PSS:") {
				memInfo.TotalPSS = extractFirstNumber(trimmedLine)
				// TOTAL PSS 是最后一项，解析完成后退出
				break
			}
		}
	}

	return memInfo
}

// extractFirstNumber 从字符串中提取第一个数字
func extractFirstNumber(line string) int64 {
	matches := reFirstNumber.FindStringSubmatch(line)
	if len(matches) >= 2 {
		// 移除逗号
		numStr := strings.ReplaceAll(matches[1], ",", "")
		num, err := strconv.ParseInt(numStr, 10, 64)
		if err != nil {
			return 0
		}
		return num
	}
	return 0
}
