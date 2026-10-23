package types

type ExecResult struct {
	Cmd   string `json:"cmd"`
	Res   string `json:"res"`
	Error string `json:"error,omitempty"`
	// Canceled 表示用户主动取消（如关闭了文件选择框），不算失败
	Canceled bool `json:"canceled,omitempty"`
	// LocalPath 为导出类操作保存到本机的文件或目录
	LocalPath string `json:"localPath,omitempty"`
}

func NewExecResultCanceled(cmd string, msg string) ExecResult {
	return ExecResult{
		Cmd:      cmd,
		Error:    msg,
		Canceled: true,
	}
}

func NewExecResultSuccess(cmd string, res string) ExecResult {
	return ExecResult{
		Cmd:   cmd,
		Res:   res,
		Error: "",
	}
}

func NewExecResultError(cmd string, error error) ExecResult {
	return ExecResult{
		Cmd:   cmd,
		Res:   "",
		Error: error.Error(),
	}
}

func NewExecResultErrorString(cmd string, error string) ExecResult {
	return ExecResult{
		Cmd:   cmd,
		Res:   "",
		Error: error,
	}
}

func NewExecResultFromError(cmd string, res string, error error) ExecResult {
	return NewExecResultFromString(cmd, res, error.Error())
}

func NewExecResultFromString(cmd string, res string, error string) ExecResult {
	return ExecResult{
		Cmd:   cmd,
		Res:   res,
		Error: error,
	}
}
