import { IconButton, Tooltip } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store/themeStore';

/**
 * Стрелка «Назад» для отдельных страниц (/devices, /download).
 *
 * Если страницу открыли из приложения, возвращаемся на шаг истории. Если
 * открыли напрямую (ссылка, перезагрузка, первый экран в Electron), шага
 * назад внутри приложения нет — тогда идём на главную.
 */
export default function PageBackButton() {
  const navigate = useNavigate();
  const { theme } = useThemeStore();

  const goBack = () => {
    // react-router v6 хранит номер записи истории в history.state.idx.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  };

  return (
    <Tooltip title="Назад">
      <IconButton aria-label="Назад" onClick={goBack} sx={{ color: theme.textSec, ml: -1 }}>
        <ArrowBack />
      </IconButton>
    </Tooltip>
  );
}
