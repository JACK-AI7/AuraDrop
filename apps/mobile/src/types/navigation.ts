import { DeviceInfo, FileMetadata, TransferSession, VisibilityMode } from '@auradrop/types';

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  NearbyDevices: undefined;
  FilePicker: undefined;
  RecipientSelection: { selectedFiles: FileMetadata[] };
  SendConfirmation: { selectedFiles: FileMetadata[]; recipient: DeviceInfo };
  ReceiverRequest: { session: TransferSession };
  TransferPreparation: { transferId: string };
  ActiveTransfer: { transferId: string };
  Completed: { session: TransferSession };
  TransferHistory: undefined;
  DeviceProfile: undefined;
  Settings: undefined;
  PrivacyCenter: undefined;
  SecurityCenter: undefined;
  Pairing: undefined;
  QrPairing: undefined;
  HelpDiagnostics: undefined;
};
