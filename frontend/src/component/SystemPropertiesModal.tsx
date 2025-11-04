import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Input, Typography, List, Button, Spin, Empty, Pagination } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

const { Text } = Typography;

export interface SystemProperty {
    key: string;
    value: string;
}

interface SystemPropertiesModalProps {
    visible: boolean;
    onClose: () => void;
    properties?: SystemProperty[];
    loading?: boolean;
    onRefresh?: () => void;
    title?: string;
}

const SystemPropertiesModal: React.FC<SystemPropertiesModalProps> = ({
                                                                         visible,
                                                                         onClose,
                                                                         properties = [],
                                                                         loading = false,
                                                                         onRefresh,
                                                                         title = '系统属性列表'
                                                                     }) => {
    const [filterText, setFilterText] = useState<string>('');
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 100;

    useEffect(() => {
        if (!visible) {
            setFilterText('');
            setCurrentPage(1);
        }
    }, [visible]);

    const filteredProps = useMemo(() => {
        if (!filterText) return properties;
        const lowerFilter = filterText.toLowerCase();
        return properties.filter(
            prop => prop.key.toLowerCase().includes(lowerFilter) ||
                prop.value.toLowerCase().includes(lowerFilter)
        );
    }, [properties, filterText]);

    const currentData = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredProps.slice(startIndex, startIndex + pageSize);
    }, [filteredProps, currentPage]);

    const handleRefresh = () => {
        setFilterText('');
        setCurrentPage(1);
        onRefresh?.();
    };

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFilterText(e.target.value);
        setCurrentPage(1);
    };

    return (
        <Modal
            title={
                <div className="flex items-center justify-between">
                    <span>{title}</span>
                    <Button
                        type="link"
                        icon={<ReloadOutlined />}
                        onClick={handleRefresh}
                        loading={loading}
                        className="mr-8"
                    >
                        刷新
                    </Button>
                </div>
            }
            open={visible}
            onCancel={onClose}
            width="90vw"
            className="max-w-4xl"
            height="80vh"
            centered
            styles={{
                body: {
                    padding: '24px',
                    height: 'calc(80vh - 120px)'
                }
            }}
            footer={null}
            destroyOnHidden
        >
            <div className="flex flex-col">
                <Input
                    placeholder="请输入需要筛选的属性"
                    prefix={<SearchOutlined />}
                    value={filterText}
                    onChange={handleFilterChange}
                    className="mb-4"
                    size="large"
                    allowClear
                />

                <Spin spinning={loading}>
                    <div className="overflow-y-auto mb-4" style={{ maxHeight: 'calc(80vh - 260px)' }}>
                        {filteredProps.length === 0 ? (
                            <Empty
                                description={filterText ? "没有找到匹配的属性" : "暂无数据"}
                                className="py-10"
                            />
                        ) : (
                            <List
                                dataSource={currentData}
                                renderItem={(item) => (
                                    <List.Item className="border-b border-gray-200 py-3">
                                        <div className="w-full">
                                            <Text strong>
                                                {item.key}:
                                            </Text>
                                            <Text strong>
                                                {item.value}
                                            </Text>
                                        </div>
                                    </List.Item>
                                )}
                            />
                        )}
                    </div>

                    {filteredProps.length > pageSize && (
                        <div className="flex justify-center">
                            <Pagination
                                current={currentPage}
                                total={filteredProps.length}
                                pageSize={pageSize}
                                onChange={setCurrentPage}
                                showSizeChanger={false}
                                showTotal={(total) => `共 ${total} 条`}
                            />
                        </div>
                    )}
                </Spin>
            </div>
        </Modal>
    );
};

export default SystemPropertiesModal;