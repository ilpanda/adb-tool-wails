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