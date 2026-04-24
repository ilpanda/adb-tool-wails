package applog

import (
	"log"
	"os"
)

const (
	CategoryStartup = "STARTUP"
	CategoryADB     = "ADB"
	CategoryAction  = "ACTION"
	CategoryAya     = "AYA"
	CategoryLog     = "LOG"
)

func Infof(category string, format string, v ...any) {
	log.Printf("[INFO] [pid=%d] [%s] "+format, append([]any{os.Getpid(), category}, v...)...)
}

func Warnf(category string, format string, v ...any) {
	log.Printf("[WARN] [pid=%d] [%s] "+format, append([]any{os.Getpid(), category}, v...)...)
}

func Errorf(category string, format string, v ...any) {
	log.Printf("[ERROR] [pid=%d] [%s] "+format, append([]any{os.Getpid(), category}, v...)...)
}
