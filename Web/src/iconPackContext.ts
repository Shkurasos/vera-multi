import React from 'react';

/**
 * Переопределение пака иконок для поддерева — нужно для превью в выборе
 * пака: каждая кнопка показывает иконку в СВОЁМ стиле, а не в текущем.
 * null — брать пак из настроек (uiPrefsStore).
 */
export const IconPackOverrideContext = React.createContext<string | null>(null);

/**
 * Замены иконок для поддерева — черновик в редакторе пака показывает правки
 * до сохранения. undefined — брать включённый пак из настроек (если не задан
 * IconPackOverrideContext: превью встроенного пака своих замен не показывает).
 */
export const CustomIconsOverrideContext = React.createContext<Record<string, unknown> | undefined>(undefined);
