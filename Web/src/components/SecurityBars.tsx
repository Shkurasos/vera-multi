import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { usersApi } from '../services/api';

interface SecurityBarsProps {
  userId: string;
  theme: any;
  /** В шапке группы полоски идут в потоке, а не абсолютно позиционируются как в профиле. */
  inline?: boolean;
}

interface SecurityFlags {
  isBot?: boolean;
  isAdminAccount?: boolean;
  accountMature?: boolean;
  hasLinkedDevice?: boolean;
  hasAdminWarnings?: boolean;
  hasComplaints?: boolean;
  hasActiveBan?: boolean;
}

interface Check {
  active: boolean;
  color: string;
  label: string;
}

const GREEN = '#4caf50';
const ORANGE = '#ff9800';
const RED = '#f44336';

/**
 * Полоски безопасности. Цвет зависит от типа аккаунта:
 * - бот: одна палочка — зелёная (нет жалоб и банов), оранжевая (есть жалобы), красная (есть баны);
 * - админ: одна красная;
 * - обычный пользователь: три зелёные — аккаунт старше месяца, привязано
 *   второе устройство по QR, нет предупреждений от админов.
 * Серый означает, что условие не выполнено.
 */
export default function SecurityBars({ userId, theme, inline }: SecurityBarsProps) {
  const [flags, setFlags] = React.useState<SecurityFlags | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setFlags(null);
    usersApi.getById(userId)
      .then(({ data }) => { if (!cancelled) setFlags(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  if (!flags) return null;

  const checks: Check[] = flags.isBot
    ? [{
        active: !flags.hasActiveBan && !flags.hasComplaints,
        color: flags.hasActiveBan ? RED : flags.hasComplaints ? ORANGE : GREEN,
        label: flags.hasActiveBan 
          ? 'Бот заблокирован администрацией' 
          : flags.hasComplaints 
            ? 'На бота есть открытые жалобы' 
            : 'Бот не имеет жалоб и блокировок',
      }]
    : flags.isAdminAccount
      ? [{ active: true, color: RED, label: 'Администратор' }]
      : [
          { active: !!flags.accountMature, color: GREEN, label: 'Аккаунт старше месяца' },
          { active: !!flags.hasLinkedDevice, color: GREEN, label: 'Привязано второе устройство' },
          { active: !flags.hasAdminWarnings, color: GREEN, label: 'Нет предупреждений от администрации' },
        ];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        ...(inline
          ? { mt: 1 }
          : {
              position: 'absolute',
              // Баннер шапки 96/140px, блок контента наезжает на него на 40/56px.
              // Смещение ставит полоски сразу под шапкой, а не на цветном фоне.
              top: { xs: 48, sm: 64 },
              left: 12,
              zIndex: 10,
            }),
      }}
    >
      {checks.map((check, i) => (
        <Tooltip key={i} title={check.label} arrow placement="bottom">
          <Box
            sx={{
              width: 5,
              height: 18,
              borderRadius: 1,
              bgcolor: check.active ? check.color : `${theme.textSec}22`,
              border: `1px solid ${check.active ? check.color : theme.border}`,
              boxShadow: check.active ? `0 0 8px ${check.color}` : undefined,
              transition: 'all 0.3s ease',
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
