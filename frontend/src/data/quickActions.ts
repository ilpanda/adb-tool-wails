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
    | 'dump-memory-info'
    | 'dump-pid'
    | 'dump-smaps'
    | 'dump-hprof'
    | 'get-package-info'
    | 'view-package'
    | 'get-package-detail-info'
    ;



export interface QuickAction {
    icon: string;
    label: string;
    color: string;
    bgColor: string;
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
            { icon: 'fa-box-open', label: '安装应用', color: 'text-blue-500', bgColor: 'bg-blue-50', action: 'install-app' },
            { icon: 'fa-camera', label: '截图保存到电脑', color: 'text-green-500', bgColor: 'bg-green-50', action: 'screenshot' },
            { icon: 'fa-tag', label: '查看当前应用包名', color: 'text-amber-500', bgColor: 'bg-amber-50', action: 'view-package' },
            { icon: 'fa-eye', label: '查看当前 Activity', color: 'text-purple-500', bgColor: 'bg-purple-50', action: 'view-current-activity' },
            { icon: 'fa-list', label: '查看所有 Activity', color: 'text-indigo-500', bgColor: 'bg-indigo-50', action: 'view-all-activities' },
            { icon: 'fa-puzzle-piece', label: '查看当前 Fragment', color: 'text-pink-500', bgColor: 'bg-pink-50', action: 'view-current-fragment' },
        ]
    },
    {
        title: "应用",
        items: [
            { icon: 'fa-hashtag', label: '查看进程 PID', color: 'text-cyan-600', bgColor: 'bg-cyan-50', action: 'dump-pid' },
            { icon: 'fa-folder-open', label: '查看应用安装路径', color: 'text-blue-600', bgColor: 'bg-blue-50', action: 'install-app-path' },
            { icon: 'fa-file-lines', label: '获取应用信息', color: 'text-sky-600', bgColor: 'bg-sky-50', action: 'get-package-info' },
            { icon: 'fa-memory', label: '查看内存 meminfo', color: 'text-purple-600', bgColor: 'bg-purple-50', action: 'dump-memory-info' },
            { icon: 'fa-download', label: '保存应用 APK 到电脑', color: 'text-indigo-700', bgColor: 'bg-indigo-50', action: 'export-app' },
            { icon: 'fa-key', label: '授予所有权限', color: 'text-emerald-500', bgColor: 'bg-emerald-50', action: 'grant-permissions' },
            { icon: 'fa-shield-alt', label: '重置权限', color: 'text-orange-500', bgColor: 'bg-orange-50', action: 'reset-permissions' },
            { icon: 'fa-map', label: '导出 smaps', color: 'text-amber-600', bgColor: 'bg-amber-50', action: 'dump-smaps' },
            { icon: 'fa-chart-pie', label: '导出 hprof', color: 'text-violet-600', bgColor: 'bg-violet-50', action: 'dump-hprof' },
            { icon: 'fa-skull-crossbones', label: '杀死应用', color: 'text-gray-700', bgColor: 'bg-gray-100', action: 'force-stop' },
            { icon: 'fa-trash-alt', label: '清除数据', color: 'text-red-500', bgColor: 'bg-red-50', action: 'clear-data' },
            { icon: 'fa-broom', label: '清除数据并重启应用', color: 'text-pink-600', bgColor: 'bg-pink-50', action: 'clear-restart-app' },
            { icon: 'fa-rotate-right', label: '重启应用', color: 'text-teal-500', bgColor: 'bg-teal-50', action: 'restart-app' },
            { icon: 'fa-circle-minus', label: '卸载应用', color: 'text-rose-600', bgColor: 'bg-rose-50', action: 'uninstall-app' },
        ]
    },
    {
        title: "按键",
        items: [
            { icon: 'fa-home', label: 'HOME 键', color: 'text-blue-500', bgColor: 'bg-blue-50', action: 'key-home' },
            { icon: 'fa-bars', label: '菜单按键', color: 'text-indigo-500', bgColor: 'bg-indigo-50', action: 'key-menu' },
            { icon: 'fa-arrow-left', label: '返回按键', color: 'text-green-500', bgColor: 'bg-green-50', action: 'key-back' },
            { icon: 'fa-power-off', label: '电源按键', color: 'text-red-500', bgColor: 'bg-red-50', action: 'key-power' },
            { icon: 'fa-volume-high', label: '增加音量按键', color: 'text-purple-500', bgColor: 'bg-purple-50', action: 'key-volume-up' },
            { icon: 'fa-volume-low', label: '降低音量按键', color: 'text-orange-500', bgColor: 'bg-orange-50', action: 'key-volume-down' },
            { icon: 'fa-volume-xmark', label: '静音按键', color: 'text-gray-500', bgColor: 'bg-gray-50', action: 'key-mute' },
            { icon: 'fa-layer-group', label: '切换应用按键', color: 'text-teal-500', bgColor: 'bg-teal-50', action: 'key-app-switch' },
        ]
    },
    {
        title: "快速跳转",
        items: [
            { icon: 'fa-globe', label: '语言设置', color: 'text-blue-600', bgColor: 'bg-blue-50', action: 'jump-locale' },
            { icon: 'fa-th-large', label: '应用管理', color: 'text-green-600', bgColor: 'bg-green-50', action: 'jump-application' },
            { icon: 'fa-bell', label: '通知与状态栏', color: 'text-amber-600', bgColor: 'bg-amber-50', action: 'jump-notification' },
            { icon: 'fa-bluetooth-b', label: '蓝牙设置', color: 'text-sky-600', bgColor: 'bg-sky-50', action: 'jump-bluetooth' },
            { icon: 'fa-keyboard', label: '管理输入法', color: 'text-indigo-600', bgColor: 'bg-indigo-50', action: 'jump-input' },
            { icon: 'fa-tv', label: '显示与亮度', color: 'text-teal-600', bgColor: 'bg-teal-50', action: 'jump-display' },
            { icon: 'fa-code-branch', label: '开发者选项', color: 'text-purple-600', bgColor: 'bg-purple-50', action: 'jump-developer' },
        ]
    },
    {
        title: "系统",
        items: [
            { icon: 'fa-info', label: '手机信息', color: 'text-indigo-600', bgColor: 'bg-indigo-50', action: 'get-system-info' },
            { icon: 'fa-cog', label: '系统属性', color: 'text-cyan-600', bgColor: 'bg-cyan-50', action: 'get-system-property' },
            { icon: 'fa-rotate', label: '重启手机', color: 'text-red-500', bgColor: 'bg-red-50', action: 'reboot-device' },
            { icon: 'fa-power-off', label: '关机', color: 'text-gray-600', bgColor: 'bg-gray-100', action: 'shutdown-device' }
        ]
    },
];