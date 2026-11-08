import { handle } from '../../src/api.js';

export const onRequest = (context) => handle(context.request, context.env, context);
