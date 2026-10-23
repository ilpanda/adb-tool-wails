package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/perf"
	"adb-tool-wails/internal/types"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// 调试导出：meminfo、smaps、showmap、线程信息与 hprof

func FormatSysMemInfo(param adb.ExecuteParams) types.ExecResult {
	result := DumpSysMemInfo(param)
	if result.Error != "" || result.Res == "" {
		return result
	}

	memInfo := perf.ParseMemInfo(result.Res)
	memInfo.Timestamp = time.Now().UnixMilli() // 添加毫秒级时间戳
	memInfo.RawMemInfo = result.Res

	jsonBytes, err := json.Marshal(memInfo)
	if err != nil {
		return types.NewExecResultError(result.Cmd, err)
	}
	return types.NewExecResultSuccess(result.Cmd, string(jsonBytes))
}

func DumpSysMemInfo(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys meminfo %s", param.PackageName))
	return execCmd(cmd)
}

func dumpSmaps(param adb.ExecuteParams) types.ExecResult {
	result := PackagePid(param)
	if result.Error != "" {
		return result
	}

	smapsCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("run-as %s cat /proc/%s/smaps ", param.PackageName, result.Res))
	if isRoot(param) {
		smapsCmd = adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("cat /proc/%s/smaps ", result.Res))
	}

	finalResult := execCmd(smapsCmd)
	finalResult.Cmd = result.Cmd + "\n" + smapsCmd
	return finalResult
}

func dumpShowMap(param adb.ExecuteParams) types.ExecResult {
	result := PackagePid(param)
	if result.Error != "" {
		return result
	}

	showMapCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("run-as %s showmap %s ", param.PackageName, result.Res))
	if isRoot(param) {
		showMapCmd = adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("showmap %s", result.Res))
	}

	finalResult := execCmd(showMapCmd)
	finalResult.Cmd = result.Cmd + "\n" + showMapCmd
	return finalResult
}

func isRoot(param adb.ExecuteParams) bool {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "whoami")
	result := execCmd(cmd)
	if result.Error == "" && strings.TrimSpace(result.Res) == "root" {
		return true
	}
	return false
}

// SaveSmaps 保存 smaps 信息
func SaveSmaps(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		OnStage:       param.OnStage,
		FilePrefix:    "smaps",
		DialogTitle:   "保存 smaps",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultCanceled("", "用户取消保存")
	}

	result := dumpSmaps(param)
	if result.Error != "" {
		return result
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 smaps\n"+result.Res, result.Error)
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

func SaveShowMap(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		OnStage:       param.OnStage,
		FilePrefix:    "show_map",
		DialogTitle:   "保存 show_map",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultCanceled("", "用户取消保存")
	}

	result := dumpShowMap(param)
	if result.Error != "" {
		return result
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 showmap\n"+result.Res, result.Error)
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

func SaveThreadInfo(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	if !isRoot(param) {
		return types.NewExecResultErrorString(packageIdResult.Cmd, "应用不是 root，无法导出线程信息")
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		OnStage:       param.OnStage,
		FilePrefix:    "thread_info",
		DialogTitle:   "保存 thread",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultCanceled("", "用户取消保存")
	}

	result := doSaveThreadInfo(param)
	if result.Error != "" {
		return result
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

func doSaveThreadInfo(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	if isRoot(param) {
		cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("debuggerd -b %s", packageIdResult.Res))
		return execCmd(cmd)
	}
	return types.NewExecResultErrorString(packageIdResult.Cmd, "应用不是 debuggable，无法导出 hprof")
}

func SaveHprof(param adb.ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		OnStage:       param.OnStage,
		FilePrefix:    "hprof",
		DialogTitle:   "保存 hprof",
		FileExtension: ".hprof",
		FilterDisplay: "文本文件 (*.hprof)",
		FilterPattern: "*.hprof",
	})

	if saveResult.Canceled {
		return types.NewExecResultCanceled("", "用户取消保存")
	}

	timestamp := time.Now().Format("2006_01_02_15_04_05")
	hprofSdcardPath := fmt.Sprintf("/data/local/tmp/%s.hprof", timestamp)
	result := execCmd(adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("am dumpheap %s %s", param.PackageName, hprofSdcardPath)))
	if result.Error != "" {
		return result
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 hprof"+"\n"+result.Res, result.Error)
	}

	param.Stage(adb.StagePulling)
	pullResult := runAPKCommand(param, "pull", hprofSdcardPath, saveResult.SavePath)
	if pullResult.Error != "" {
		return pullResult
	}
	finalCmd := result.Cmd + "\n" + pullResult.Cmd

	rmResult := execCmd(adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("rm %s", hprofSdcardPath)))
	finalCmd = finalCmd + "\n" + rmResult.Cmd

	success := types.NewExecResultSuccess(finalCmd, fmt.Sprintf("hprof 已保存到: %s", saveResult.SavePath))
	success.LocalPath = saveResult.SavePath
	return success
}
