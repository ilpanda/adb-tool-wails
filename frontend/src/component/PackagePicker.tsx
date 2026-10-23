import {useMemo, useState} from 'react';
import {Button, message, Select, Tooltip} from 'antd';
import {useDeviceStore} from '../store/deviceStore';
import {EMPTY_PACKAGES, getForegroundPackage, usePackageListStore} from '../store/packageListStore';
import {useAppListStore} from '../store/appListStore';

interface PackagePickerProps {
    value: string;
    onChange: (packageName: string) => void;
    disabled?: boolean;
    className?: string;
}

// 包名选择：可搜索的已安装包名列表 + 「使用前台应用」。快捷功能与性能监控共用
function PackagePicker({value, onChange, disabled, className = ''}: PackagePickerProps) {
    const selectedDevice = useDeviceStore(state => state.selectedDevice);
    const packages = usePackageListStore(state =>
        selectedDevice ? state.packagesByDevice[selectedDevice.id] ?? EMPTY_PACKAGES : EMPTY_PACKAGES);
    // 应用名来自应用列表（选中设备后会在后台预加载），未加载完时只显示包名
    const apps = useAppListStore(state => (selectedDevice ? state.appListCache.get(selectedDevice.id) : undefined));
    const [picking, setPicking] = useState(false);
    const noDevice = !selectedDevice;

    const options = useMemo(() => {
        const labels = new Map((apps ?? []).map(app => [app.packageName, app.label]));
        return packages.map(pkg => {
            const name = labels.get(pkg);
            // 没有应用名（很多系统组件的名称就是包名）时不加括号
            const appName = name && name !== pkg ? name : '';
            return {
                value: pkg,
                searchText: `${pkg} ${appName}`.toLowerCase(),
                label: (
                    <span>
                        <span className="font-mono">{pkg}</span>
                        {appName && <span className="text-mute"> ({appName})</span>}
                    </span>
                ),
            };
        });
    }, [packages, apps]);

    const pickForeground = async () => {
        if (!selectedDevice) return;
        setPicking(true);
        try {
            const pkg = await getForegroundPackage(selectedDevice.id);
            onChange(pkg);
            message.success(`已切换到前台应用 ${pkg}`);
        } catch (error: any) {
            message.error(`无法获取前台应用：${error?.message || error}`);
        } finally {
            setPicking(false);
        }
    };

    return (
        <div className={`flex min-w-0 items-center gap-3 ${className}`}>
            <Select
                value={value || undefined}
                onChange={onChange}
                placeholder={noDevice ? '请先连接设备' : '输入包名或应用名搜索'}
                disabled={noDevice || disabled}
                showSearch
                // 包名和应用名都能搜，例如输入「微信」或「tencent」
                filterOption={(input, option) => option?.searchText.includes(input.trim().toLowerCase()) ?? false}
                options={options}
                className="min-w-0 flex-1 [&_.ant-select-selection-item]:text-[13px]"
            />
            <Tooltip title="把手机前台正在运行的应用设为目标应用">
                <Button
                    icon={<i className="fa-solid fa-location-crosshairs text-[12px]"/>}
                    loading={picking}
                    disabled={noDevice || disabled}
                    onClick={() => void pickForeground()}
                >
                    使用前台应用
                </Button>
            </Tooltip>
        </div>
    );
}

export default PackagePicker;
