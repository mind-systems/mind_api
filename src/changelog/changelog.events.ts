import { ChangeAction, ChangeEntity } from './changelog.enums';

export const CHANGE_EVENT_LOGGED = 'changelog.logged';

export interface ChangeEventPayload {
  id: number;
  entity: ChangeEntity;
  refId: string;
  action: ChangeAction;
  userId: string;
}
