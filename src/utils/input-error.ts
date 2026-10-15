/** An expected, actionable validation failure, safe to return as HTTP 400. */
export class InputError extends Error {
  constructor(message:string){super(message);this.name='InputError';}
}
