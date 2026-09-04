import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import { useThemeStore } from '../store/themeStore';
import { useChatBgPrefsStore, STOCK_WALLPAPERS } from '../store/chatBgPrefsStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Диалог выбора глобальных стоковых обоев (применяются ко всем чатам по умолчанию).
 */
export default function WallpaperSettingsDialog({ open, onClose }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const globalStockWallpaper = useChatBgPrefsStore((s) => s.globalStockWallpaper);
  const setGlobalStockWallpaper = useChatBgPrefsStore((s) => s.setGlobalStockWallpaper);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: theme.bgHeader,
          border: `1px solid ${theme.border}`,
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        sx={{
          color: theme.text,
          fontSize: 18,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 2,
        }}
      >
        🖼️ Глобальные обои для всех чатов
        <IconButton onClick={onClose} size="small" sx={{ color: theme.textSec }}>
          <Close />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pb: 2 }}>
        <Typography sx={{ color: theme.textSec, fontSize: 13, mb: 2 }}>
          Выберите обои, которые будут применяться ко всем чатам по умолчанию.
          В конкретном чате можно установить свои обои через меню «⋮».
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 1.5,
          }}
        >
          {STOCK_WALLPAPERS.map((wp) => {
            const isSelected = globalStockWallpaper === wp.id;
            return (
              <Box
                key={wp.id}
                onClick={() => setGlobalStockWallpaper(wp.id)}
                sx={{
                  position: 'relative',
                  aspectRatio: '16/10',
                  borderRadius: 2,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: isSelected ? `3px solid ${theme.accent}` : `1px solid ${theme.border}`,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.05)',
                    boxShadow: `0 4px 16px ${theme.accent}40`,
                  },
                }}
              >
                {wp.type === 'none' ? (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: theme.bg,
                      color: theme.textSec,
                      fontSize: 28,
                    }}
                  >
                    ✖️
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      height: '100%',
                      backgroundImage: `url(${wp.url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                )}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    py: 0.5,
                    px: 1,
                    textAlign: 'center',
                  }}
                >
                  {wp.name}
                </Box>
                {isSelected && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      bgcolor: theme.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 'bold',
                    }}
                  >
                    ✓
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: theme.text }}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );
}
