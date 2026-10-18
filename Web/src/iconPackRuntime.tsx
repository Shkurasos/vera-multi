import React from 'react';
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';
import { useUiPrefsStore } from './store/uiPrefsStore';
import { useIconPackStore } from './store/iconPackStore';
import { CustomIconsOverrideContext, IconPackOverrideContext } from './iconPackContext';
import type { CustomIcon } from './utils/iconPackFormat';

/**
 * Рантайм своих паков иконок — используется шимом (mui-icons-shim.tsx).
 * Отдельным файлом, потому что шим генерируется скриптом: здесь логика,
 * там — только вызов.
 */

/**
 * Замены, действующие в этом месте дерева:
 *  1. черновик редактора (CustomIconsOverrideContext);
 *  2. превью встроенного пака (IconPackOverrideContext) — без замен;
 *  3. включённый свой пак из настроек.
 */
export function useActiveCustomIcons(): Record<string, CustomIcon> | null {
  const draft = React.useContext(CustomIconsOverrideContext) as Record<string, CustomIcon> | undefined;
  const builtinPreview = React.useContext(IconPackOverrideContext);
  const packId = useUiPrefsStore((s) => s.customPack);
  const icons = useIconPackStore((s) => (packId ? s.packs[packId]?.icons : undefined));
  if (draft !== undefined) return draft;
  if (builtinPreview) return null;
  return icons || null;
}

/**
 * Текст или картинка в рамке SvgIcon: размер, цвет, sx и className ведут себя
 * как у обычной иконки, поэтому замена встаёт в любую кнопку без правок.
 */
export const CustomSvgIcon = React.forwardRef<SVGSVGElement, SvgIconProps & { icon: CustomIcon }>(
  ({ icon, className, ...props }, ref) => {
    const maskId = `vera-ico-m${React.useId().replace(/:/g, '')}`;
    const cls = `vera-ico vera-ico-custom${className ? ` ${className}` : ''}`;
    if (icon.kind === 'text') {
      return (
        <SvgIcon ref={ref} viewBox="0 0 24 24" {...props} className={cls}>
          <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central"
            fontSize={Array.from(icon.text).length > 2 ? 9 : Array.from(icon.text).length > 1 ? 12 : 19}
            fontWeight={700} fill="currentColor" style={{ fontFamily: 'inherit' }}>
            {icon.text}
          </text>
        </SvgIcon>
      );
    }
    if (icon.kind === 'image') {
      // tint: картинка становится маской, залитой цветом иконки, — так своя
      // картинка подхватывает цвет кнопки (активная, наведение, тема).
      return (
        <SvgIcon ref={ref} viewBox="0 0 24 24" {...props} className={cls}>
          {icon.tint ? (
            <>
              <defs>
                <mask id={maskId} style={{ maskType: 'alpha' } as React.CSSProperties}>
                  <image href={icon.src} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
                </mask>
              </defs>
              <rect x="0" y="0" width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />
            </>
          ) : (
            <image href={icon.src} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
          )}
        </SvgIcon>
      );
    }
    return null;
  },
);
CustomSvgIcon.displayName = 'CustomSvgIcon';
