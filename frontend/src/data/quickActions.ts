export type ActionType =
    | 'install-app'
    | 'screenshot'
    | 'view-current-activity'
    | 'view-all-activities'
    | 'view-current-fragment'
    | 'clear-data'
    | 'reset-permissions'
    | 'force-stop'
    | 'restart-app'
    | 'launch-app'
    | 'screenshot-clipboard'
    | 'deep-link'
    | 'install-apk-file'
    | 'reboot-device'
    | 'shutdown-device'
    | 'key-home'
    | 'key-menu'
    | 'key-back'
    | 'key-power'
    | 'key-volume-up'
    | 'key-volume-down'
    | 'key-mute'
    | 'key-app-switch'
    | 'get-system-property'
    | 'uninstall-app'
    | 'grant-permissions'
    | 'install-app-path'
    | 'export-app'
    | 'clear-restart-app'
    | 'get-system-info'
    | 'jump-locale'
    | 'jump-developer'
    | 'jump-application'
    | 'jump-notification'
    | 'jump-bluetooth'
    | 'jump-input'
    | 'jump-display'
    | 'jump-application-detail'
    | 'jump-wifi-settings'
    | 'dump-memory-info'
    | 'dump-pid'
    | 'dump-smaps'
    | 'dump-hprof'
    | 'get-package-info'
    | 'view-package'
    | 'get-package-detail-info'
    | 'toggle-gpu-profile'
    | 'toggle-gpu-overdraw'
    | 'toggle-layout-bounds'
    | 'dump-thread'
    | 'dump-show-map'
    | 'thread-sched'
    ;



export interface QuickAction {
    icon: string;
    label: string;
    action: ActionType;
}

export interface QuickActionSection {
    title: string;
    items: QuickAction[];
}

export const quickActions: QuickActionSection[] = [
    {
        title: "常用",
        items: [
            { icon: 'fa-box-open', label: '安装应用', action: 'install-app' },
            { icon: 'fa-camera', label: '截图保存到电脑', action: 'screenshot' },
            { icon: 'fa-clipboard', label: '截图复制到剪贴板', action: 'screenshot-clipboard' },
            { icon: 'fa-link', label: 'Deep Link 测试', action: 'deep-link' },
            { icon: 'fa-tag', label: '查看当前应用包名', action: 'view-package' },
            { icon: 'fa-eye', label: '查看当前 Activity', action: 'view-current-activity' },
            { icon: 'fa-list', label: '查看所有 Activity', action: 'view-all-activities' },
            { icon: 'fa-puzzle-piece', label: '查看当前 Fragment', action: 'view-current-fragment' },
        ]
    },
    {
        title: "应用",
        items: [
            { icon: 'fa-hashtag', label: '查看进程 PID', action: 'dump-pid' },
            { icon: 'fa-folder-open', label: '查看应用安装路径', action: 'install-app-path' },
            { icon: 'fa-file-lines', label: '获取应用信息', action: 'get-package-info' },
            { icon: 'fa-memory', label: '查看内存 meminfo', action: 'dump-memory-info' },
            { icon: 'fa-download', label: '保存应用 APK 到电脑', action: 'export-app' },
            { icon: 'fa-key', label: '授予所有权限', action: 'grant-permissions' },
            { icon: 'fa-shield-alt', label: '重置权限', action: 'reset-permissions' },
            { icon: 'fa-circle-info', label: '跳转应用详情页', action: 'jump-application-detail' },
            { icon: 'fa-map', label: '导出 smaps', action: 'dump-smaps' },
            { icon: 'fa-table-list', label: '导出 showmap', action: 'dump-show-map' },
            { icon: 'fa-chart-pie', label: '导出 hprof', action: 'dump-hprof' },
            { icon: 'fa-layer-group', label: '导出线程信息', action: 'dump-thread' },
            { icon: 'fa-microchip', label: '线程优先级与核绑定', action: 'thread-sched' },
            { icon: 'fa-play', label: '启动应用', action: 'launch-app' },
            { icon: 'fa-skull-crossbones', label: '杀死应用', action: 'force-stop' },
            { icon: 'fa-trash-alt', label: '清除数据', action: 'clear-data' },
            { icon: 'fa-broom', label: '清除数据并重启应用', action: 'clear-restart-app' },
            { icon: 'fa-rotate-right', label: '重启应用', action: 'restart-app' },
            { icon: 'fa-circle-minus', label: '卸载应用', action: 'uninstall-app' },
        ]
    },
    {
        title: "按键",
        items: [
            { icon: 'fa-home', label: 'HOME 键', action: 'key-home' },
            { icon: 'fa-bars', label: '菜单按键', action: 'key-menu' },
            { icon: 'fa-arrow-left', label: '返回按键', action: 'key-back' },
            { icon: 'fa-power-off', label: '电源按键', action: 'key-power' },
            { icon: 'fa-volume-high', label: '增加音量按键', action: 'key-volume-up' },
            { icon: 'fa-volume-low', label: '降低音量按键', action: 'key-volume-down' },
            { icon: 'fa-volume-xmark', label: '静音按键', action: 'key-mute' },
            { icon: 'fa-layer-group', label: '切换应用按键', action: 'key-app-switch' },
        ]
    },
    {
        title: "快捷设置",
        items: [
            { icon: 'fa-code-branch', label: '开发者选项', action: 'jump-developer' },
            { icon: 'fa-chart-bar', label: 'GPU 呈现模式', action: 'toggle-gpu-profile' },
            { icon: 'fa-layer-group', label: 'GPU 过度绘制', action: 'toggle-gpu-overdraw' },
            { icon: 'fa-border-all', label: '显示布局边界', action: 'toggle-layout-bounds' },
            { icon: 'fa-wifi', label: 'WIFI', action: 'jump-wifi-settings' },
            { icon: 'fa-globe', label: '语言设置', action: 'jump-locale' },
            { icon: 'fa-th-large', label: '应用管理', action: 'jump-application' },
            { icon: 'fa-bell', label: '通知与状态栏', action: 'jump-notification' },
            { icon: 'fa-brands fa-bluetooth-b', label: '蓝牙设置', action: 'jump-bluetooth' },
            { icon: 'fa-keyboard', label: '管理输入法', action: 'jump-input' },
            { icon: 'fa-tv', label: '显示与亮度', action: 'jump-display' },
        ]
    },
    {
        title: "系统",
        items: [
            { icon: 'fa-info', label: '手机信息', action: 'get-system-info' },
            { icon: 'fa-cog', label: '系统属性', action: 'get-system-property' },
            { icon: 'fa-rotate', label: '重启手机', action: 'reboot-device' },
            { icon: 'fa-power-off', label: '关机', action: 'shutdown-device' }
        ]
    },
];

// 执行反馈按类型区分：
// instant 即时操作，只提示结果；query 查询，结果在抽屉中展示；
// file 涉及文件选择或保存，完成后可在访达中显示；modal 由页面自行弹窗展示
export type ActionKind = 'instant' | 'query' | 'file' | 'modal';

export interface ActionMeta {
    kind: ActionKind;
    needsPackage?: boolean;
    // 危险操作执行前的确认文案，{pkg} 会替换为当前包名
    danger?: string;
}

const APP_INSTANT: ActionMeta = {kind: 'instant', needsPackage: true};
const APP_QUERY: ActionMeta = {kind: 'query', needsPackage: true};
const APP_FILE: ActionMeta = {kind: 'file', needsPackage: true};

export const ACTION_META: Record<ActionType, ActionMeta> = {
    'install-app': {kind: 'file'},
    // 拖入窗口的 APK，不在快捷功能列表中展示
    'install-apk-file': {kind: 'instant'},
    'screenshot': {kind: 'file'},
    'screenshot-clipboard': {kind: 'instant'},
    'deep-link': {kind: 'modal'},
    'view-package': {kind: 'query'},
    'view-current-activity': {kind: 'query'},
    'view-all-activities': {kind: 'query'},
    'view-current-fragment': {kind: 'query'},

    'dump-pid': APP_QUERY,
    'install-app-path': APP_QUERY,
    'get-package-info': APP_QUERY,
    'get-package-detail-info': APP_QUERY,
    'dump-memory-info': APP_QUERY,
    'export-app': APP_FILE,
    'grant-permissions': APP_INSTANT,
    'reset-permissions': {...APP_INSTANT, danger: '将撤销 {pkg} 已授予的运行时权限。'},
    'jump-application-detail': APP_INSTANT,
    'dump-smaps': APP_FILE,
    'dump-show-map': APP_FILE,
    'dump-hprof': APP_FILE,
    'dump-thread': APP_FILE,
    'thread-sched': {kind: 'modal', needsPackage: true},
    'force-stop': APP_INSTANT,
    'clear-data': {...APP_INSTANT, danger: '将清除 {pkg} 的全部数据，包括账号、缓存和本地文件，无法恢复。'},
    'clear-restart-app': {...APP_INSTANT, danger: '将清除 {pkg} 的全部数据并重新启动，数据无法恢复。'},
    'restart-app': APP_INSTANT,
    'launch-app': APP_INSTANT,
    'uninstall-app': {...APP_INSTANT, danger: '将从设备上卸载 {pkg}，应用数据会一并删除。'},

    'key-home': {kind: 'instant'},
    'key-menu': {kind: 'instant'},
    'key-back': {kind: 'instant'},
    'key-power': {kind: 'instant'},
    'key-volume-up': {kind: 'instant'},
    'key-volume-down': {kind: 'instant'},
    'key-mute': {kind: 'instant'},
    'key-app-switch': {kind: 'instant'},

    'jump-developer': {kind: 'instant'},
    'toggle-gpu-profile': {kind: 'instant'},
    'toggle-gpu-overdraw': {kind: 'instant'},
    'toggle-layout-bounds': {kind: 'instant'},
    'jump-wifi-settings': {kind: 'instant'},
    'jump-locale': {kind: 'instant'},
    'jump-application': {kind: 'instant'},
    'jump-notification': {kind: 'instant'},
    'jump-bluetooth': {kind: 'instant'},
    'jump-input': {kind: 'instant'},
    'jump-display': {kind: 'instant'},

    'get-system-info': {kind: 'query'},
    'get-system-property': {kind: 'modal'},
    'reboot-device': {kind: 'instant', danger: '设备将立即重启，正在进行的调试会中断。'},
    'shutdown-device': {kind: 'instant', danger: '设备将关机，需要手动开机后才能重新连接。'},
};

// 卡片上的一行说明
export const ACTION_DESC: Partial<Record<ActionType, string>> = {
    'install-app': '选择本地 APK 安装到设备',
    'screenshot': '截取当前屏幕并保存为 PNG',
    'screenshot-clipboard': '截图后直接粘贴到聊天或文档',
    'deep-link': '用 VIEW Intent 打开链接',
    'view-package': '前台应用的包名',
    'view-current-activity': '前台界面的 Activity',
    'view-all-activities': 'Activity 任务栈',
    'view-current-fragment': '当前应用的 Fragment 层级',

    'dump-pid': 'pidof 获取主进程 PID',
    'install-app-path': 'pm path 查看 APK 位置',
    'get-package-info': '版本号、SDK、安装时间等',
    'dump-memory-info': 'dumpsys meminfo 内存概况',
    'export-app': '拉取基础 APK 到本地目录',
    'grant-permissions': '授予声明的全部运行时权限',
    'reset-permissions': '撤销已授予的运行时权限',
    'jump-application-detail': '打开系统的应用信息页',
    'dump-smaps': '需 debuggable，保存为文本',
    'dump-show-map': '需 debuggable，保存为文本',
    'dump-hprof': '需 debuggable，堆转储到本地',
    'dump-thread': '需 root，debuggerd 线程栈',
    'thread-sched': '查看线程优先级与可运行核',
    'force-stop': 'am force-stop 结束进程',
    'clear-data': 'pm clear 清除全部数据',
    'clear-restart-app': '清除数据后重新启动',
    'restart-app': '结束进程后重新启动',
    'launch-app': '打开应用的启动页',
    'uninstall-app': '从设备卸载应用',

    'jump-developer': '打开开发者选项',
    'toggle-gpu-profile': '开关 GPU 呈现模式条形图',
    'toggle-gpu-overdraw': '开关过度绘制着色',
    'toggle-layout-bounds': '开关布局边界显示',
    'jump-wifi-settings': '打开 WLAN 设置',
    'jump-locale': '打开语言设置',
    'jump-application': '打开应用管理',
    'jump-notification': '打开通知设置',
    'jump-bluetooth': '打开蓝牙设置',
    'jump-input': '打开输入法管理',
    'jump-display': '打开显示设置',

    'get-system-info': '型号、系统版本、屏幕等',
    'get-system-property': 'getprop 全部系统属性',
    'reboot-device': '立即重启设备',
    'shutdown-device': '立即关机',
};

// 图标默认用 solid 风格，data 中已写明风格（如 fa-brands）的保持不变
export function iconClass(icon: string): string {
    return /\bfa-(brands|regular|solid)\b/.test(icon) ? icon : `fa-solid ${icon}`;
}

// 图标色调，与 Pen 设计稿一致：
// teal 安装/导出/媒体，blue 查看与跳转，violet 调试分析，amber 权限与重启，rose 结束/清除/关机，slate 系统信息
export type ActionTone = 'teal' | 'blue' | 'violet' | 'amber' | 'rose' | 'slate';

export const TONE_CLASS: Record<ActionTone, {box: string; icon: string}> = {
    teal: {box: 'bg-tone-teal-soft', icon: 'text-tone-teal'},
    blue: {box: 'bg-tone-blue-soft', icon: 'text-tone-blue'},
    violet: {box: 'bg-tone-violet-soft', icon: 'text-tone-violet'},
    amber: {box: 'bg-tone-amber-soft', icon: 'text-tone-amber'},
    rose: {box: 'bg-tone-rose-soft', icon: 'text-tone-rose'},
    slate: {box: 'bg-tone-slate-soft', icon: 'text-tone-slate'},
};

export const ACTION_TONE: Record<ActionType, ActionTone> = {
    'install-app': 'teal',
    'screenshot': 'blue',
    'screenshot-clipboard': 'blue',
    'deep-link': 'violet',
    'install-apk-file': 'teal',
    'view-package': 'blue',
    'view-current-activity': 'blue',
    'view-all-activities': 'blue',
    'view-current-fragment': 'violet',

    'dump-pid': 'violet',
    'install-app-path': 'blue',
    'get-package-info': 'blue',
    'get-package-detail-info': 'blue',
    'dump-memory-info': 'violet',
    'export-app': 'teal',
    'grant-permissions': 'amber',
    'reset-permissions': 'amber',
    'jump-application-detail': 'blue',
    'dump-smaps': 'violet',
    'dump-show-map': 'violet',
    'dump-hprof': 'violet',
    'dump-thread': 'violet',
    'thread-sched': 'violet',
    'force-stop': 'rose',
    'clear-data': 'rose',
    'clear-restart-app': 'rose',
    'restart-app': 'amber',
    'launch-app': 'teal',
    'uninstall-app': 'rose',

    'key-home': 'blue',
    'key-menu': 'blue',
    'key-back': 'blue',
    'key-power': 'rose',
    'key-volume-up': 'teal',
    'key-volume-down': 'teal',
    'key-mute': 'teal',
    'key-app-switch': 'blue',

    'jump-developer': 'amber',
    'toggle-gpu-profile': 'violet',
    'toggle-gpu-overdraw': 'violet',
    'toggle-layout-bounds': 'blue',
    'jump-wifi-settings': 'teal',
    'jump-locale': 'blue',
    'jump-application': 'blue',
    'jump-notification': 'blue',
    'jump-bluetooth': 'teal',
    'jump-input': 'blue',
    'jump-display': 'blue',

    'get-system-info': 'slate',
    'get-system-property': 'slate',
    'reboot-device': 'amber',
    'shutdown-device': 'rose',
};
