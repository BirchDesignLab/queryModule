// Generated from packages/api/openapi.json by pnpm --filter @querymodule/client gen:api. Do not edit.
export interface paths {
  "/api/v1/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Liveness for the Docker healthcheck; no data */
    get: operations["getHealth"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/meta": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Versions and config hash; the client refuses to run below minClientVersion */
    get: operations["getMeta"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/locales/{locale}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Locale bundle, UI strings only */
    get: operations["getLocale"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/config": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** ClientSiteConfig allowlist; never Source.server or mock data */
    get: operations["getConfig"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/v1/me/preferences": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** The caller's own preference row; nulls when unset */
    get: operations["getMePreferences"];
    /** Replace the caller's own preference row */
    put: operations["putMePreferences"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    ApiError: {
      error: {
        /** @enum {string} */
        code:
          | "validationFailed"
          | "unauthenticated"
          | "stepUpRequired"
          | "mfaEnrollmentRequired"
          | "forbidden"
          | "notFound"
          | "configHashMismatch"
          | "delegationCredentialsMissing"
          | "payloadTooLarge"
          | "rateLimited"
          | "internal"
          | "unavailable";
        params?: {
          [key: string]: string | number;
        };
        errors?: {
          key: string;
          params?: {
            [key: string]: string | number | boolean;
          };
        }[];
        correlationId?: string;
        requestId: string;
      };
    };
    getHealth200: {
      /** @constant */
      status: "ok";
    };
    getMeta200: {
      /** @constant */
      apiVersion: "v1";
      coreVersion: string;
      configSchemaVersion: number;
      configHash: string;
      minClientVersion: string | null;
    };
    getLocale200: {
      [key: string]: string;
    };
    getConfig200: {
      /** @constant */
      schemaVersion: 1;
      configHash: string;
      site: {
        id: string;
        labelKey: string;
      };
      locales: string[];
      features: {
        credentials: boolean;
        delegation: boolean;
        resultHide: boolean;
        adminAudit: boolean;
      };
      personas: {
        key: string;
        labelKey: string;
        /** @enum {string} */
        layout: "dispatch" | "mobileUnit" | "mobile";
      }[];
      delegation: {
        purposes: {
          key: string;
          labelKey: string;
          maxDurationMinutes?: number;
        }[];
        maxDurationMinutes: number;
      };
      terminal: {
        delimiter: string;
      };
      defaults: {
        [key: string]: string | number | boolean;
      };
      picklists: {
        id: string;
        values: {
          code: string;
          labelKey: string;
          /** @default true */
          enabled: boolean;
          parent?: string;
        }[];
      }[];
      queryTypes: {
        code: string;
        labelKey: string;
        /** @default false */
        allowPlateOnly: boolean;
        sections: {
          key: string;
          labelKey: string;
          when?: components["schemas"]["Condition"];
        }[];
        defaults?: {
          [key: string]: string | number | boolean;
        };
        fields: {
          key: string;
          labelKey: string;
          /** @enum {string} */
          dataType: "string" | "number" | "year" | "date" | "boolean" | "picklist";
          /** @enum {string} */
          role?: "type";
          picklist?: string;
          picklistFilter?: {
            byField: string;
          };
          defaultValue?: string | number | boolean;
          /** @default true */
          visible: boolean;
          /** @default false */
          required: boolean;
          /** @default base */
          section: string;
          /** @default false */
          custom: boolean;
          minLength?: number;
          /** @default 64 */
          maxLength: number;
          pattern?: string;
          /**
           * @default printableAscii
           * @enum {string}
           */
          charset: "printableAscii" | "printable";
          /**
           * @default none
           * @enum {string}
           */
          transform: "upper" | "none";
          /**
           * @default integer
           * @enum {string}
           */
          numberKind: "integer" | "decimal";
          /**
           * @default 2000
           * @enum {string}
           */
          century: "2000" | "past";
          /**
           * @default [
           *       "MMDDYYYY",
           *       "MM/DD/YYYY",
           *       "MM-DD-YYYY",
           *       "YYYY-MM-DD"
           *     ]
           */
          inputFormats: string[];
          /** @default MMDDYYYY */
          outputFormat: string;
        }[];
        /** @default [] */
        rules: {
          field: string;
          when: components["schemas"]["Condition"];
          /** @enum {string} */
          effect: "show" | "hide" | "require" | "setDefault";
          value?: string | number | boolean;
        }[];
        sources: {
          sourceId: string;
          selectedByDefault: boolean;
          /** @default false */
          plateOnly: boolean;
          when?: components["schemas"]["Condition"];
        }[];
        alsoRun?: {
          queryType: string;
          fieldMap: {
            [key: string]: string;
          };
          when?: components["schemas"]["Condition"];
        }[];
      }[];
      commands: {
        code: string;
        queryType: string;
        presets?: {
          [key: string]: string | number | boolean;
        };
        positions: (
          | string
          | {
              field: string;
              /** @constant */
              rest: true;
            }
        )[];
      }[];
      keywords: {
        keyword: string;
        /** @enum {string} */
        severity: "critical" | "warning" | "info";
        except?: string[];
      }[];
      keywordSeverityStyles: {
        critical: {
          color: string;
          background: string;
          bold: boolean;
          icon: string;
          marker: string;
          /** @default false */
          audibleCue: boolean;
        };
        warning: {
          color: string;
          background: string;
          bold: boolean;
          icon: string;
          marker: string;
          /** @default false */
          audibleCue: boolean;
        };
        info: {
          color: string;
          background: string;
          bold: boolean;
          icon: string;
          marker: string;
          /** @default false */
          audibleCue: boolean;
        };
      };
      responseMappings: {
        id: string;
        queryType: string;
        sourceId?: string;
        persona?: string;
        when?: components["schemas"]["Condition"];
        elements: (
          | {
              /** @constant */
              kind: "value";
              path: string;
              labelKey: string;
              /** @enum {string} */
              view: "summary" | "detail" | "both";
              format?:
                | {
                    /** @constant */
                    type: "text";
                  }
                | {
                    /** @constant */
                    type: "upper";
                  }
                | {
                    /** @constant */
                    type: "phone";
                  }
                | {
                    /** @constant */
                    type: "date";
                    pattern: string;
                  }
                | {
                    /** @constant */
                    type: "template";
                    template: string;
                  };
              /** @default true */
              highlight: boolean;
            }
          | {
              /** @constant */
              kind: "table";
              path: string;
              labelKey: string;
              /** @enum {string} */
              view: "summary" | "detail" | "both";
              /** @default true */
              highlight: boolean;
              columns: {
                path: string;
                labelKey: string;
                format?:
                  | {
                      /** @constant */
                      type: "text";
                    }
                  | {
                      /** @constant */
                      type: "upper";
                    }
                  | {
                      /** @constant */
                      type: "phone";
                    }
                  | {
                      /** @constant */
                      type: "date";
                      pattern: string;
                    }
                  | {
                      /** @constant */
                      type: "template";
                      template: string;
                    };
                highlight?: boolean;
              }[];
            }
        )[];
      }[];
      quickAccess: string[];
      shortcuts?: {
        [key: string]:
          | {
              keys: string;
              /** @enum {string} */
              context: "global" | "panel" | "results" | "terminal";
            }
          | {
              keys: string;
              /** @enum {string} */
              context: "global" | "panel" | "results" | "terminal";
            }[];
      };
      theme?: {
        /**
         * @default day
         * @enum {string}
         */
        defaultMode: "day" | "night" | "redShift";
        /**
         * @default off
         * @enum {string}
         */
        auto: "off" | "os" | "time";
        tokens?: {
          all?: {
            [key: string]: string;
          };
          day?: {
            [key: string]: string;
          };
          night?: {
            [key: string]: string;
          };
          redShift?: {
            [key: string]: string;
          };
        };
      };
      sources: {
        id: string;
        labelKey: string;
        /** @enum {string} */
        scope: "state" | "national" | "local";
        timeoutMs: number;
        requiresCredentials: boolean;
      }[];
    };
    Condition:
      | {
          field: string;
          /** @enum {string} */
          op: "eq" | "neq";
          value:
            | (string | number | boolean)
            | {
                $default: string;
              };
        }
      | {
          field: string;
          /** @enum {string} */
          op: "in" | "notIn";
          value: (string | number | boolean)[];
        }
      | {
          field: string;
          /** @enum {string} */
          op: "gt" | "gte" | "lt" | "lte";
          value:
            | (string | number | boolean)
            | {
                $default: string;
              };
        }
      | {
          field: string;
          /** @enum {string} */
          op: "empty" | "notEmpty";
        }
      | {
          all: components["schemas"]["Condition"][];
        }
      | {
          any: components["schemas"]["Condition"][];
        }
      | {
          not: components["schemas"]["Condition"];
        };
    getMePreferences200: {
      themeMode: ("day" | "night" | "redShift" | "auto") | null;
      personaOverride: string | null;
      layout: {
        /** @enum {string} */
        orientation: "horizontal" | "vertical";
        /** @enum {string} */
        terminal: "toggle" | "pane";
      } | null;
    };
    putMePreferences200: {
      themeMode: ("day" | "night" | "redShift" | "auto") | null;
      personaOverride: string | null;
      layout: {
        /** @enum {string} */
        orientation: "horizontal" | "vertical";
        /** @enum {string} */
        terminal: "toggle" | "pane";
      } | null;
    };
    putMePreferencesBody: {
      themeMode: ("day" | "night" | "redShift" | "auto") | null;
      personaOverride: string | null;
      layout: {
        /** @enum {string} */
        orientation: "horizontal" | "vertical";
        /** @enum {string} */
        terminal: "toggle" | "pane";
      } | null;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  getHealth: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Alive */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["getHealth200"];
        };
      };
    };
  };
  getMeta: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Versions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["getMeta200"];
        };
      };
    };
  };
  getLocale: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        locale: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Bundle */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["getLocale200"];
        };
      };
      /** @description Malformed locale parameter (validationFailed) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
      /** @description Locale not listed in SiteConfig.locales */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
    };
  };
  getConfig: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Client config */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["getConfig200"];
        };
      };
      /** @description No session */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
    };
  };
  getMePreferences: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Preferences */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["getMePreferences200"];
        };
      };
      /** @description No session */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
    };
  };
  putMePreferences: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["putMePreferencesBody"];
      };
    };
    responses: {
      /** @description Preferences */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["putMePreferences200"];
        };
      };
      /** @description Malformed preferences body (validationFailed) */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
      /** @description No session */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiError"];
        };
      };
    };
  };
}
