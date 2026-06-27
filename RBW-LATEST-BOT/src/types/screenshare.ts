import { TextChannel } from 'discord.js';
import { IScreenshareSession } from '../models/ScreenshareSession';

export interface ScreenshareSessionResult {
  success: boolean;
  session?: IScreenshareSession;
  error?: string;
  dontlogResult?: {
    online: boolean;
    dontlog: boolean;
  };
}

export interface ScreenshareFreezeResult {
  success: boolean;
  channel?: TextChannel;
  error?: string;
}

export interface ScreenshareCloseResult {
  success: boolean;
  error?: string;
}

export interface ScreenshareValidationResult {
  isValid: boolean;
  error?: string;
}

export interface ScreensharePermissionCheck {
  hasPermission: boolean;
  error?: string;
}

export interface ScreenshareChannelConfig {
  requestsChannelId?: string;
  categoryId?: string;
  screensharerRoleId?: string;
  frozenRoleId?: string;
}

