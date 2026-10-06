import React, { useState, useEffect } from 'react';
import { store, MobileAppState } from '../state/transfer-store';
import { AuraRadar, DeviceCard } from '../components';
import { colors, typography, spacing, borderRadius } from '@auradrop/ui';
import { DeviceInfo } from '@auradrop/types';

export interface HomeScreenProps {
  onNavigate: (screen: string, params?: any) => void;
  params?: any;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate }) => {
  const [appState, setAppState] = useState<MobileAppState>(store.getState());

  useEffect(() => {
    return store.subscribe((newState) => setAppState(newState));
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: colors.dark.background,
      color: colors.dark.textPrimary,
      padding: spacing.md,
      boxSizing: 'border-box',
    }}>
      {/* Top Bar / Profile Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: spacing.md,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <div
            onClick={() => onNavigate('DeviceProfile')}
            style={{
              width: 44,
              height: 44,
              borderRadius: borderRadius.md,
              background: 'linear-gradient(135deg, #7928CA 0%, #4FACFE 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              cursor: 'pointer',
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{appState.localDevice.name}</div>
            <div
              onClick={() => onNavigate('Settings')}
              style={{
                fontSize: 12,
                color: colors.dark.primary,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              ● {appState.localDevice.visibilityMode === 'everyone' ? 'Everyone Nearby' : appState.localDevice.visibilityMode === 'contacts' ? 'Contacts Only' : 'Invisible'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: spacing.xs }}>
          <button
            onClick={() => onNavigate('QrPairing')}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: borderRadius.md,
              color: '#FFF',
              padding: '10px 14px',
              fontSize: 14,
              cursor: 'pointer',
            }}
            title="QR Pairing"
          >
            📷 QR
          </button>
          <button
            onClick={() => onNavigate('TransferHistory')}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: borderRadius.md,
              color: '#FFF',
              padding: '10px 14px',
              fontSize: 14,
              cursor: 'pointer',
            }}
            title="History"
          >
            ⏱️
          </button>
        </div>
      </div>

      {/* Main Radar Discovery Section */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        <AuraRadar
          nearbyDevices={appState.nearbyDevices}
          onSelectDevice={(device: DeviceInfo) => {
            store.selectRecipient(device);
            onNavigate('RecipientSelection', { selectedFiles: appState.selectedFiles });
          }}
          selectedDeviceId={appState.selectedRecipients[0]?.id}
        />

        <div style={{ textAlign: 'center', marginTop: spacing.sm }}>
          <div style={{ fontSize: 14, color: colors.dark.textSecondary }}>
            {appState.nearbyDevices.length === 0
              ? 'Pulsing beacon... Bring another device nearby'
              : `${appState.nearbyDevices.length} device(s) ready to receive`}
          </div>
        </div>
      </div>

      {/* Large Central Action: Send Files */}
      <div style={{ paddingBottom: spacing.lg }}>
        <button
          onClick={() => onNavigate('FilePicker')}
          style={{
            width: '100%',
            padding: '18px 24px',
            borderRadius: borderRadius.xl,
            border: 'none',
            background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
            color: '#0B0D13',
            fontSize: 17,
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(0, 242, 254, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            transition: 'transform 0.15s ease',
          }}
        >
          <span>🚀</span>
          <span>Send Files Direct</span>
        </button>

        <div style={{
          display: 'flex',
          justifyContent: 'space-around',
          marginTop: spacing.md,
          fontSize: 12,
          color: colors.dark.textMuted,
        }}>
          <span onClick={() => onNavigate('NearbyDevices')} style={{ cursor: 'pointer' }}>📡 Discovered Peers ({appState.nearbyDevices.length})</span>
          <span onClick={() => onNavigate('PrivacyCenter')} style={{ cursor: 'pointer' }}>🛡️ 100% Direct P2P</span>
          <span onClick={() => onNavigate('HelpDiagnostics')} style={{ cursor: 'pointer' }}>⚡ Diagnostics</span>
        </div>
      </div>
    </div>
  );
};
