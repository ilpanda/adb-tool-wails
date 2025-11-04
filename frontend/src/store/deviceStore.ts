// store/deviceStore.ts
import { create } from 'zustand'

interface DeviceStore {
    devices: DeviceInfo[];
    setDevices: (device: DeviceInfo[]) => void;
    selectedDevice: DeviceInfo | null;  // 单个设备或 null
    setSelectedDevices: (device: DeviceInfo | null) => void;
    toggleDevice: (device: DeviceInfo) => void;
}

export interface DeviceInfo {
    id: string;
    name: string;
}

export const useDeviceStore = create<DeviceStore>((set) => ({
    devices: [],  // 初始化为 null
    setDevices: (devices) => set({ devices: devices }),
    selectedDevice: null,  // 初始化为 null
    setSelectedDevices: (device) => set({ selectedDevice: device }),
    toggleDevice: (device) => set((state) => {
        // 如果当前选中的就是这个设备，则取消选中
        if (state.selectedDevice?.id === device.id) {
            return { selectedDevice: null };
        }
        // 否则选中这个设备
        return { selectedDevice: device };
    })
}));