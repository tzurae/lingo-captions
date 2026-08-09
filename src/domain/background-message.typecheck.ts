import type { RequestMessage, ResponseMessage } from './types';

const request: RequestMessage = { type: 'GET_SETTINGS' };
const response: ResponseMessage = { ok: true, data: undefined };

void request;
void response;
