import type {ThemeConfig} from 'antd';

// 与 DESIGN.md 及 style.css 中的 @theme 保持一致
export const colors = {
    ink: '#171717',
    body: '#4d4d4d',
    mute: '#8f8f8f',
    faint: '#a1a1a1',
    hairline: '#ebebeb',
    hairlineSoft: '#f2f2f2',
    canvas: '#fafafa',
    elevated: '#ffffff',
    link: '#0070f3',
    linkDeep: '#0761d1',
    linkSoft: '#d3e5ff',
    error: '#ee0000',
    errorDeep: '#c50000',
    warning: '#f5a623',
    warningSoft: '#ffefcf',
    warningDeep: '#ab570a',
};

export const FONT_SANS = 'Geist, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';
export const FONT_MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const SHADOW_FLOATING = '0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.08)';

export const appTheme: ThemeConfig = {
    token: {
        fontFamily: FONT_SANS,
        fontFamilyCode: FONT_MONO,
        fontSize: 14,
        colorPrimary: colors.ink,
        colorInfo: colors.link,
        colorLink: colors.link,
        colorLinkHover: colors.linkDeep,
        colorSuccess: colors.link,
        colorWarning: colors.warning,
        colorError: colors.error,
        colorErrorHover: colors.errorDeep,
        colorErrorActive: colors.errorDeep,
        colorText: colors.ink,
        colorTextSecondary: colors.body,
        colorTextTertiary: colors.mute,
        colorTextQuaternary: colors.faint,
        colorTextPlaceholder: colors.faint,
        colorBorder: colors.hairline,
        colorBorderSecondary: colors.hairlineSoft,
        colorSplit: colors.hairlineSoft,
        colorBgLayout: colors.canvas,
        colorBgContainer: colors.elevated,
        colorBgElevated: colors.elevated,
        colorFillTertiary: colors.hairlineSoft,
        colorFillQuaternary: colors.canvas,
        borderRadius: 6,
        borderRadiusLG: 12,
        borderRadiusSM: 4,
        controlHeight: 34,
        controlOutline: 'rgba(0,112,243,0.15)',
        boxShadow: SHADOW_FLOATING,
        boxShadowSecondary: SHADOW_FLOATING,
        // 下拉、菜单等列表项的悬停与选中背景；主色是黑色，默认派生出的选中色过深
        controlItemBgHover: colors.canvas,
        controlItemBgActive: colors.hairlineSoft,
        controlItemBgActiveHover: colors.hairline,
    },
    components: {
        Button: {
            fontWeight: 500,
            primaryShadow: 'none',
            defaultShadow: 'none',
            dangerShadow: 'none',
        },
        Select: {
            optionActiveBg: colors.canvas,
            optionSelectedBg: colors.hairlineSoft,
            optionSelectedColor: colors.ink,
            optionSelectedFontWeight: 500,
        },
        Segmented: {
            itemSelectedBg: colors.elevated,
            trackBg: colors.hairlineSoft,
        },
        Modal: {
            titleFontSize: 16,
        },
        Tooltip: {
            colorBgSpotlight: colors.ink,
        },
    },
};
