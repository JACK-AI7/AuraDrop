import React, { useState } from 'react';
import {
  SplashScreen,
  HomeScreen,
  NearbyDevicesScreen,
  FilePickerScreen,
  RecipientSelectionScreen,
  SendConfirmationScreen,
  ReceiverRequestScreen,
  TransferPreparationScreen,
  ActiveTransferScreen,
  CompletedScreen,
  TransferHistoryScreen,
  DeviceProfileScreen,
  SettingsScreen,
  PrivacyCenterScreen,
  SecurityCenterScreen,
  PairingScreen,
  QrPairingScreen,
  HelpDiagnosticsScreen,
} from './screens';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<string>('Home');
  const [screenParams, setScreenParams] = useState<any>(null);

  const navigate = (screen: string, params?: any) => {
    setScreenParams(params);
    setCurrentScreen(screen);
  };

  const renderCurrentScreen = () => {
    switch (currentScreen) {
      case 'Splash':
        return <SplashScreen onNavigate={navigate} params={screenParams} />;
      case 'Home':
        return <HomeScreen onNavigate={navigate} params={screenParams} />;
      case 'NearbyDevices':
        return <NearbyDevicesScreen onNavigate={navigate} params={screenParams} />;
      case 'FilePicker':
        return <FilePickerScreen onNavigate={navigate} params={screenParams} />;
      case 'RecipientSelection':
        return <RecipientSelectionScreen onNavigate={navigate} params={screenParams} />;
      case 'SendConfirmation':
        return <SendConfirmationScreen onNavigate={navigate} params={screenParams} />;
      case 'ReceiverRequest':
        return <ReceiverRequestScreen onNavigate={navigate} params={screenParams} />;
      case 'TransferPreparation':
        return <TransferPreparationScreen onNavigate={navigate} params={screenParams} />;
      case 'ActiveTransfer':
        return <ActiveTransferScreen onNavigate={navigate} params={screenParams} />;
      case 'Completed':
        return <CompletedScreen onNavigate={navigate} params={screenParams} />;
      case 'TransferHistory':
        return <TransferHistoryScreen onNavigate={navigate} params={screenParams} />;
      case 'DeviceProfile':
        return <DeviceProfileScreen onNavigate={navigate} params={screenParams} />;
      case 'Settings':
        return <SettingsScreen onNavigate={navigate} params={screenParams} />;
      case 'PrivacyCenter':
        return <PrivacyCenterScreen onNavigate={navigate} params={screenParams} />;
      case 'SecurityCenter':
        return <SecurityCenterScreen onNavigate={navigate} params={screenParams} />;
      case 'Pairing':
        return <PairingScreen onNavigate={navigate} params={screenParams} />;
      case 'QrPairing':
        return <QrPairingScreen onNavigate={navigate} params={screenParams} />;
      case 'HelpDiagnostics':
        return <HelpDiagnosticsScreen onNavigate={navigate} params={screenParams} />;
      default:
        return <HomeScreen onNavigate={navigate} params={screenParams} />;
    }
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: 480,
      height: '100vh',
      margin: '0 auto',
      background: '#0B0D13',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 0 50px rgba(0,0,0,0.8)',
    }}>
      {renderCurrentScreen()}
    </div>
  );
}
