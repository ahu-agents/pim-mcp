export class IcsParseError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "IcsParseError";
  }
}

export class IcsGenerateError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "IcsGenerateError";
  }
}
