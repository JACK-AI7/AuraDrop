import React from 'react';
import { DeviceInfo, FileMetadata, TransferSession, TransportType } from '@auradrop/types';
import { colors, typography, spacing, borderRadius } from '@auradrop/ui';
import { SpeedCalculator } from '@auradrop/transfer-engine';

export interface AuraRadarProps {
  nearbyDevices: DeviceInfo[];
  onSelectDevice: (device: DeviceInfo) => void;
  selectedDeviceId?: string;
  isDiscovering?: boolean;
}

export const AuraRadar: React.FC<AuraRadarProps> = ({
  nearbyDevices,
  onSelectDevice,
  selectedDeviceId,
  isDiscovering = true,
}) => {
  return (
    <div style={{
      position: 'relative',
      height: 280,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* Concentric ambient radar circles */}
      <div style={{ position: 'absolute', width: 90, height: 90, borderRadius: '50%', border: '1px solid rgba(0, 242, 254, 0.2)' }} />
      <div style={{ position: 'absolute', width: 170, height: 170, borderRadius: '50%', border: '1px solid rgba(0, 242, 254, 0.15)' }} />
      <div style={{ position: 'absolute', width: 250, height: 250, borderRadius: '50%', border: '1px solid rgba(0, 242, 254, 0.1)' }} />

      {/* Central Device Avatar */}
      <div style={{
        width: 68,
        height: 68,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 24px rgba(0, 242, 254, 0.45)',
        zIndex: 5,
      }}>
        <span style={{ fontSize: 24 }}>📱</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#000' }}>Me</span>
      </div>

      {/* Floating Nearby Peer Nodes */}
      {nearbyDevices.map((device, index) => {
        const angle = (index * (360 / Math.max(1, nearbyDevices.length)) * Math.PI) / 180;
        const radius = 95;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const isSelected = selectedDeviceId === device.id;

        return (
          <div
            key={device.id}
            onClick={() => onSelectDevice(device)}
            style={{
              position: 'absolute',
              transform: `translate(${x}px, ${y}px)`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'pointer',
              zIndex: 10,
              transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            <div style={{
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: isSelected ? '#00F2FE' : '#1A1E2E',
              border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isSelected ? '0 0 20px #00F2FE' : '0 4px 12px rgba(0,0,0,0.3)',
              color: isSelected ? '#000' : '#FFF',
              fontSize: 20,
            }}>
              {device.platform === 'android' ? '🤖' : device.platform === 'ios' ? '🍏' : '💻'}
            </div>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: isSelected ? '#00F2FE' : '#94A3B8',
              marginTop: 4,
              maxWidth: 70,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {device.name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export interface DeviceCardProps {
  device: DeviceInfo;
  selected?: boolean;
  onSelect?: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, selected = false, onSelect }) => {
  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? 'rgba(0, 242, 254, 0.12)' : '#1A1E2E',
        border: selected ? '1.5px solid #00F2FE' : '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: borderRadius.lg,
        padding: spacing.md,
        display: 'flex',
        alignItems: 'center',
        gap: spacing.md,
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
    >
      <div style={{
        width: 46,
        height: 46,
        borderRadius: borderRadius.md,
        background: 'rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
      }}>
        {device.platform === 'android' ? '📱' : device.platform === 'ios' ? '🍏' : '💻'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: '#FFF' }}>{device.name}</div>
        <div style={{ fontSize: 12, color: '#94A3B8' }}>{device.platform.toUpperCase()} · Nearby LAN</div>
      </div>
      <div style={{
        padding: '4px 10px',
        borderRadius: 12,
        background: 'rgba(16, 185, 129, 0.15)',
        color: '#10B981',
        fontSize: 11,
        fontWeight: 600,
      }}>
        Ready
      </div>
    </div>
  );
};

export interface ProgressBarProps {
  percentage: number;
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

export const TransferProgressDisplay: React.FC<ProgressBarProps> = ({
  percentage,
  transferredBytes,
  totalBytes,
  speedBytesPerSec,
  etaSeconds,
}) => {
  return (
    <div style={{ width: '100%', padding: spacing.md, background: '#131722', borderRadius: borderRadius.lg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <span style={{ fontSize: 13, color: '#94A3B8' }}>{SpeedCalculator.formatBytes(transferredBytes)} of {SpeedCalculator.formatBytes(totalBytes)}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#00F2FE' }}>{percentage}%</span>
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, percentage)}%`,
          background: 'linear-gradient(90deg, #00F2FE 0%, #4FACFE 100%)',
          transition: 'width 0.25s ease-out',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: spacing.sm, fontSize: 12, color: '#94A3B8' }}>
        <span>⚡ {SpeedCalculator.formatSpeed(speedBytesPerSec)}</span>
        <span>⏱️ {SpeedCalculator.formatEta(etaSeconds)}</span>
      </div>
    </div>
  );
};
