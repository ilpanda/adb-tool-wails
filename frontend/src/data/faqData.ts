export const faqData = `
# 常见问题

## ADB 安装

确保系统已安装 Android Debug Bridge

- **Windows:** [下载 Platform Tools](https://developer.android.com/tools/releases/platform-tools)
- **macOS:** \`brew install android-platform-tools\`
- **Linux:** \`sudo apt install android-tools-adb\`

## USB 调试设置

在 Android 设备上启用 USB 调试

1. 进入 **设置** → **关于手机**
2. 连续点击 **版本号** 7 次启用开发者选项
3. 返回 **设置** → **开发者选项** → 启用 **USB 调试**

## 常见错误

### 设备未授权 (unauthorized)

手机上会弹出授权提示，点击"始终允许此计算机调试"并确认。

\`\`\`bash
adb kill-server && adb start-server
\`\`\`

### 设备离线 (offline)

重新插拔 USB 数据线，或执行：

\`\`\`bash
adb reconnect
\`\`\`

### 找不到设备

检查以下几点：
- USB 数据线是否支持数据传输（不是仅充电线）
- 设备是否已开启 USB 调试
- 尝试更换 USB 接口
- 驱动是否正确安装（Windows）

### 权限错误

#### 清除数据权限不足

当遇到以下报错时：

\`\`\`text
Exception occurred while executing 'clear':
java.lang.SecurityException: PID 8391 does not have permission android.permission.CLEAR_APP_USER_DATA to clear data of package xxxx
	at com.android.server.am.ActivityManagerService.clearApplicationUserData(ActivityManagerService.java:3837)
\`\`\`

或者：

\`\`\`text
Exception occurred while executing 'grant':
java.lang.SecurityException: grantRuntimePermission: Neither user 2000 nor current process has android.permission.GRANT_RUNTIME_PERMISSIONS.
	at android.app.ContextImpl.enforce(ContextImpl.java:2096)
	......
\`\`\`

需要打开手机**开发者选项**中的**禁止权限监控**按钮（默认是关闭的）。

#### 系统应用清除限制

如果遇到以下报错：

\`\`\`text
Exception occurred while executing 'clear':
java.lang.SecurityException: adb clearing user data is forbidden.
	at com.android.server.pm.OplusClearDataProtectManager.interceptClearUserDataIfNeeded(OplusClearDataProtectManager.java:88)
	at com.android.server.pm.OplusBasePackageManagerService$OplusPackageManagerInternalImpl.interceptClearUserDataIfNeeded(OplusBasePackageManagerService.java:531)
	at com.android.server.am.ActivityManagerService.clearApplicationUserData(ActivityManagerService.java:4708)
	......
\`\`\`

表示部分手机预装系统 App 不支持 adb clear。

## 权限问题

### Linux 权限不足

需要配置 udev 规则：

\`\`\`bash
sudo usermod -aG plugdev $USER
sudo apt-get install android-sdk-platform-tools-common
\`\`\`

### macOS 安全设置

首次使用需要在"系统偏好设置" → "安全性与隐私"中允许 ADB 运行。
`;