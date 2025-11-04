package types

type ExecResult struct {
	Cmd   string `json:"cmd"`
	Res   string `json:"res"`
	Error string `json:"error,omitempty"`
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
