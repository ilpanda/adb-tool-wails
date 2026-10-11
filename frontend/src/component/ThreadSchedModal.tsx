import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, Button, Input, Modal, Select, Table, Tag, Tooltip} from 'antd';
import type {ColumnsType} from 'antd/es/table';
import {ReloadOutlined, SearchOutlined} from '@ant-design/icons';
import {GetThreadSchedInfo} from '../../wailsjs/go/main/App';
import {adb} from '../../wailsjs/go/models';

interface ThreadSchedModalProps {
    visible: boolean;
    onClose: () => void;
    packageName: string;
    deviceId: string;
}

// 按簇性能从低到高取色
const CLUSTER_COLORS: Record<string, string> = {
    '小核': 'green',
    '中核': 'cyan',
    '大核': 'orange',
    '超大核': 'red',
};

const STATE_NAMES: Record<string, string> = {
    R: '运行',
    S: '睡眠',
    D: '不可中断',
    T: '停止',
    t: '跟踪停止',
    Z: '僵尸',
    X: '退出',
};

function clusterColor(label: string) {
    return CLUSTER_COLORS[label] ?? 'blue';
}

function formatFreq(khz: number) {
    return khz > 0 ? `${(khz / 1000000).toFixed(2)}GHz` : '';
}

function formatCpus(cpus: number[]) {
    if (cpus.length === 0) return '';
    const first = cpus[0];
    const last = cpus[cpus.length - 1];
    return cpus.length > 1 && last - first + 1 === cpus.length ? `${first}-${last}` : cpus.join(',');
}

// 直接显示 Cpus_allowed_list；若只落在某一个簇内，则使用该簇颜色
function AllowedCpus({thread, clusters}: { thread: adb.ThreadSched; clusters: adb.CpuCluster[] }) {
    const allowed = thread.allowedCpus ?? [];
    if (allowed.length === 0) {
        return <span className="text-gray-500">{thread.cpusAllowed || '-'}</span>;
    }
    const cluster = clusters.find(c => allowed.every(cpu => c.cpus.includes(cpu)));
    const isAll = clusters.flatMap(c => c.cpus).every(cpu => allowed.includes(cpu));
    return <Tag color={isAll || !cluster ? 'default' : clusterColor(cluster.label)}>{thread.cpusAllowed}</Tag>;
}

const ThreadSchedModal: React.FC<ThreadSchedModalProps> = ({visible, onClose, packageName, deviceId}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState<adb.ThreadSchedResult | null>(null);
    const [pid, setPid] = useState(0);
    const [keyword, setKeyword] = useState('');

    const load = useCallback(async (targetPid: number) => {
        if (!packageName) {
            setError('请先选择应用包名');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await GetThreadSchedInfo(deviceId, packageName, targetPid);
            setData(result);
            setPid(result.pid);
        } catch (e: any) {
            setError(e?.toString() || '获取线程信息失败');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [packageName, deviceId]);

    useEffect(() => {
        if (visible) {
            setPid(0);
            load(0);
        } else {
            setKeyword('');
            setData(null);
            setError('');
        }
    }, [visible, load]);

    const clusters = data?.clusters ?? [];

    const filteredThreads = useMemo(() => {
        const threads = data?.threads ?? [];
        const lower = keyword.trim().toLowerCase();
        if (!lower) return threads;
        return threads.filter(t => t.name.toLowerCase().includes(lower) || String(t.tid) === lower);
    }, [data, keyword]);

    const columns: ColumnsType<adb.ThreadSched> = [
        {
            title: 'TID',
            dataIndex: 'tid',
            width: 90,
            sorter: (a, b) => a.tid - b.tid,
        },
        {
            title: '线程名',
            dataIndex: 'name',
            width: 200,
            ellipsis: true,
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: '状态',
            dataIndex: 'state',
            width: 90,
            render: (state: string) => (
                <span className={state === 'R' ? 'text-green-600 font-medium' : 'text-gray-600'}>
                    {state} {STATE_NAMES[state] ?? ''}
                </span>
            ),
        },
        {
            title: <Tooltip title="内核 prio，与 systrace / Perfetto 一致：普通线程为 120+nice，实时线程（标 RT）为 99-rtprio，数值越小优先级越高">prio</Tooltip>,
            dataIndex: 'prio',
            width: 140,
            sorter: (a, b) => a.prio - b.prio,
            render: (prio: number, record) => (
                <span>
                    {prio}
                    {(record.policy === 'FIFO' || record.policy === 'RR') && (
                        <Tooltip title={`实时调度 SCHED_${record.policy}，rtprio=${record.rtPriority}`}>
                            <Tag color="magenta" className="ml-2">RT</Tag>
                        </Tooltip>
                    )}
                </span>
            ),
        },
        {
            title: <Tooltip title="nice 值及对应的 Process.THREAD_PRIORITY_* 常量">nice</Tooltip>,
            dataIndex: 'nice',
            width: 190,
            sorter: (a, b) => a.nice - b.nice,
            render: (nice: number, record) => (
                <span>
                    {nice}
                    {record.niceName && <span className="text-gray-400 ml-2">{record.niceName}</span>}
                </span>
            ),
        },
        {
            title: <Tooltip title="Cpus_allowed_list：线程允许运行的 CPU 编号">可运行核</Tooltip>,
            key: 'allowed',
            width: 220,
            sorter: (a, b) => (a.allowedCpus?.length ?? 0) - (b.allowedCpus?.length ?? 0),
            render: (_, record) => <AllowedCpus thread={record} clusters={clusters}/>,
        },
        {
            title: 'cpuset',
            dataIndex: 'cpuset',
            width: 140,
            filters: Array.from(new Set((data?.threads ?? []).map(t => t.cpuset))).map(c => ({text: c, value: c})),
            onFilter: (value, record) => record.cpuset === value,
        },
    ];

    return (
        <Modal
            title={
                <div className="flex items-center justify-between">
                    <span>线程调度信息</span>
                    <Button
                        type="link"
                        icon={<ReloadOutlined/>}
                        onClick={() => load(pid)}
                        loading={loading}
                        className="mr-8"
                    >
                        刷新
                    </Button>
                </div>
            }
            open={visible}
            onCancel={onClose}
            footer={null}
            width={1200}
            centered
            destroyOnClose
        >
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    <Select
                        value={pid || undefined}
                        onChange={(value: number) => load(value)}
                        placeholder={packageName || '未选择应用'}
                        className="min-w-[360px]"
                        disabled={loading || !data}
                        options={(data?.processes ?? []).map(p => ({value: p.pid, label: `${p.name}  (${p.pid})`}))}
                    />
                    <Input
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        placeholder="按线程名或 TID 过滤"
                        allowClear
                        prefix={<SearchOutlined className="text-gray-400"/>}
                        className="max-w-[320px]"
                    />
                    {data && (
                        <span className="text-gray-500 text-sm">
                            {filteredThreads.length} / {data.threads?.length ?? 0} 个线程
                        </span>
                    )}
                </div>

                {clusters.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Tooltip title="同一簇内的核共享频率，最高频率越高性能越强（左小右大）"><span>CPU 簇：</span></Tooltip>
                        {clusters.map(c => (
                            <Tag key={c.label} color={clusterColor(c.label)}>
                                {c.label} {formatCpus(c.cpus)}  {formatFreq(c.maxFreq)}
                            </Tag>
                        ))}
                    </div>
                )}

                {error && <Alert type="error" message={error} showIcon/>}

                <Table<adb.ThreadSched>
                    rowKey="tid"
                    size="small"
                    loading={loading}
                    columns={columns}
                    dataSource={filteredThreads}
                    pagination={false}
                    scroll={{x: 1150, y: '60vh'}}
                />
            </div>
        </Modal>
    );
};

export default ThreadSchedModal;
