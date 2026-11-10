// Public, read-only shared pages. No login: the link's token decides what is shown (see src/share.js).
import { handleShare } from '../../src/share.js';

export const onRequest = (context) => handleShare(context.request, context.env);
