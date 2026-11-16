import { expect,it } from 'vitest';
import { isSameOriginSubmission } from './same-origin';
it('accepts a browser-facing LAN host when Next uses an internal hostname',()=>{
 expect(isSameOriginSubmission(new Request('http://localhost:3100/api/data-operations/book-stock',{headers:{host:'127.0.0.1:3100',origin:'http://127.0.0.1:3100'}}))).toBe(true);
});
it('rejects cross-site and malformed origins',()=>{
 for(const origin of ['https://attacker.example','null','not-a-url']) expect(isSameOriginSubmission(new Request('http://localhost:3100/api/test',{headers:{host:'127.0.0.1:3100',origin}}))).toBe(false);
});
