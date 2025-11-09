
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
    | 'get-system-info'
    | 'jump-locale'
    | 'jump-developer'
    | 'jump-application'
    | 'jump-notification'
    | 'jump-bluetooth'
    | 'jump-input'
    | 'jump-display'
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
            { icon: 'fa-eye', label: '查看当前 Activity', color: 'text-purple-500', bgColor: 'bg-purple-50', action: 'view-current-activity' },
            { icon: 'fa-list', label: '查看所有 Activity', color: 'text-indigo-500', bgColor: 'bg-indigo-50', action: 'view-all-activities' },
            { icon: 'fa-puzzle-piece', label: '查看当前 Fragment', color: 'text-pink-500', bgColor: 'bg-pink-50', action: 'view-current-fragment' },
        ]
    },
    {
        title: "应用",
        items: [
            { icon: 'fa-trash-alt', label: '清除数据', color: 'text-red-500', bgColor: 'bg-red-50', action: 'clear-data' },
            { icon: 'fa-key', label: '授予所有权限', color: 'text-emerald-500', bgColor: 'bg-emerald-50', action: 'grant-permissions' },
            { icon: 'fa-shield-alt', label: '重置权限', color: 'text-orange-500', bgColor: 'bg-orange-50', action: 'reset-permissions' },
            { icon: 'fa-folder-open', label: '查看应用安装路径', color: 'text-blue-600', bgColor: 'bg-blue-50', action: 'install-app-path' },
            { icon: 'fa-download', label: '保存应用 APK 到电脑', color: 'text-indigo-700', bgColor: 'bg-indigo-50', action: 'export-app' },
            { icon: 'fa-skull-crossbones', label: '杀死应用', color: 'text-gray-700', bgColor: 'bg-gray-100', action: 'force-stop' },
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
            { icon: 'fa-code-branch', label: '开发者选项', color: 'text-purple-600', bgColor: 'bg-purple-50', action: 'jump-developer' },
            { icon: 'fa-th-large', label: '应用管理', color: 'text-green-600', bgColor: 'bg-green-50', action: 'jump-application' },
            { icon: 'fa-bell', label: '通知设置', color: 'text-amber-600', bgColor: 'bg-amber-50', action: 'jump-notification' },
            { icon: 'fa-bluetooth-b', label: '蓝牙设置', color: 'text-sky-600', bgColor: 'bg-sky-50', action: 'jump-bluetooth' },
            { icon: 'fa-keyboard', label: '输入法设置', color: 'text-indigo-600', bgColor: 'bg-indigo-50', action: 'jump-input' },
            { icon: 'fa-tv', label: '显示设置', color: 'text-teal-600', bgColor: 'bg-teal-50', action: 'jump-display' }
        ]
    },
    {
        title: "系统",
        items: [
            { icon: 'fa-info', label: '系统信息', color: 'text-indigo-600', bgColor: 'bg-indigo-50', action: 'get-system-info' },
            { icon: 'fa-cog', label: '系统属性', color: 'text-cyan-600', bgColor: 'bg-cyan-50', action: 'get-system-property' },
            { icon: 'fa-rotate', label: '重启手机', color: 'text-red-500', bgColor: 'bg-red-50', action: 'reboot-device' },
            { icon: 'fa-power-off', label: '关机', color: 'text-gray-600', bgColor: 'bg-gray-100', action: 'shutdown-device' }
        ]
    },
];