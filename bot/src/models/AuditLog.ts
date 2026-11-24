import mongoose, { Document, Schema } from 'mongoose';

export type AuditSource = 'discord' | 'minecraft' | 'api' | 'system';

export interface IAuditLog extends Document {
  action: string;
  category: string;
  actorId?: string;
  actorName?: string;
  guildId?: string;
  channelId?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  commandName?: string;
  source: AuditSource;
  success: boolean;
  reason?: string;
  error?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  action: { type: String, required: true, index: true },
  category: { type: String, required: true, index: true },
  actorId: { type: String, index: true },
  actorName: { type: String },
  guildId: { type: String, index: true },
  channelId: { type: String },
  targetType: { type: String },
  targetId: { type: String, index: true },
  targetName: { type: String },
  commandName: { type: String, index: true },
  source: { type: String, required: true, enum: ['discord', 'minecraft', 'api', 'system'], default: 'system' },
  success: { type: Boolean, required: true, default: true, index: true },
  reason: { type: String },
  error: { type: String },
  before: { type: Schema.Types.Mixed },
  after: { type: Schema.Types.Mixed },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: () => new Date(), index: true },
}, { versionKey: false });

AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ category: 1, createdAt: -1 });
AuditLogSchema.index({ guildId: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
