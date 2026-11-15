package main

import "adb-tool-wails/internal/i18n"

// SetLanguage synchronizes the resolved UI language for native dialogs and
// application-generated backend messages. Preferences live in the frontend.
func (a *App) SetLanguage(locale string) {
	i18n.SetLanguage(locale)
}
