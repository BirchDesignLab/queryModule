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
    "/api/v1/queries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit a query; answers 202 with the correlation id once the request is recorded */
        post: operations["submitQuery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The live config version and the shared draft, with documents */
        get: operations["getAdminConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save the shared draft; the base must be the live version */
        put: operations["putAdminConfigDraft"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Validate a document by the spec 5.8 chain; diagnostics by JSON pointer */
        post: operations["validateAdminConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish the draft and activate it; refused on any validation error */
        post: operations["publishAdminConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Version history, newest first; never rewritten */
        get: operations["listAdminConfigVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/versions/{version}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish an older version as a new version */
        post: operations["rollbackAdminConfig"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/config/versions/{version}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One version document as JSON (git round trip) */
        get: operations["exportAdminConfigVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Users with role and state; no secrets */
        get: operations["listAdminUsers"];
        put?: never;
        /** Create a user; the one-time password is returned once */
        post: operations["createAdminUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a user and revoke their sessions in one transaction */
        post: operations["disableAdminUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change a user role */
        put: operations["setAdminUserRole"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A user's live sessions by row id; never tokens */
        get: operations["listAdminUserSessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/sessions/{sessionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke one session */
        delete: operations["revokeAdminSession"];
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
                code: "validationFailed" | "unauthenticated" | "stepUpRequired" | "mfaEnrollmentRequired" | "forbidden" | "notFound" | "configHashMismatch" | "delegationCredentialsMissing" | "draftConflict" | "lastAdmin" | "payloadTooLarge" | "rateLimited" | "internal" | "unavailable";
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
                adminConfig: boolean;
                adminUsers: boolean;
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
                positions: (string | {
                    field: string;
                    /** @constant */
                    rest: true;
                })[];
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
                elements: ({
                    /** @constant */
                    kind: "value";
                    path: string;
                    labelKey: string;
                    /** @enum {string} */
                    view: "summary" | "detail" | "both";
                    format?: {
                        /** @constant */
                        type: "text";
                    } | {
                        /** @constant */
                        type: "upper";
                    } | {
                        /** @constant */
                        type: "phone";
                    } | {
                        /** @constant */
                        type: "date";
                        pattern: string;
                    } | {
                        /** @constant */
                        type: "template";
                        template: string;
                    };
                    /** @default true */
                    highlight: boolean;
                } | {
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
                        format?: {
                            /** @constant */
                            type: "text";
                        } | {
                            /** @constant */
                            type: "upper";
                        } | {
                            /** @constant */
                            type: "phone";
                        } | {
                            /** @constant */
                            type: "date";
                            pattern: string;
                        } | {
                            /** @constant */
                            type: "template";
                            template: string;
                        };
                        highlight?: boolean;
                    }[];
                })[];
            }[];
            quickAccess: string[];
            shortcuts?: {
                [key: string]: {
                    keys: string;
                    /** @enum {string} */
                    context: "global" | "panel" | "results" | "terminal";
                } | {
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
                defaultMode: "day" | "night" | "redShift" | "auto";
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
        Condition: {
            field: string;
            /** @enum {string} */
            op: "eq" | "neq";
            value: (string | number | boolean) | {
                $default: string;
            };
        } | {
            field: string;
            /** @enum {string} */
            op: "in" | "notIn";
            value: (string | number | boolean)[];
        } | {
            field: string;
            /** @enum {string} */
            op: "gt" | "gte" | "lt" | "lte";
            value: (string | number | boolean) | {
                $default: string;
            };
        } | {
            field: string;
            /** @enum {string} */
            op: "empty" | "notEmpty";
        } | {
            all: components["schemas"]["Condition"][];
        } | {
            any: components["schemas"]["Condition"][];
        } | {
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
        submitQuery202: {
            correlationId: string;
            acknowledgedAt: number;
            parts: {
                partId: number;
                queryType: string;
                /** @enum {string} */
                status: "dispatched" | "skipped";
                sourceIds: string[];
                droppedSourceIds: string[];
            }[];
        };
        submitQueryBody: {
            queryType: string;
            values: {
                [key: string]: string | number | boolean | null;
            };
            sourceIds: string[];
            /** @enum {string} */
            mode: "normal" | "plateOnly";
            configHash: string;
        };
        getAdminConfig200: {
            siteId: string;
            live: {
                id: string;
                version: number;
                /** @enum {string} */
                status: "draft" | "published" | "superseded";
                configHash: string | null;
                baseVersion: number | null;
                createdBy: string;
                createdAt: number;
                publishedBy: string | null;
                publishedAt: number | null;
                rollbackOf: number | null;
                document: {
                    siteConfig: {
                        [key: string]: unknown;
                    };
                    locales: {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                    mock?: {
                        [key: string]: unknown;
                    };
                };
            };
            draft: {
                id: string;
                version: number;
                /** @enum {string} */
                status: "draft" | "published" | "superseded";
                configHash: string | null;
                baseVersion: number | null;
                createdBy: string;
                createdAt: number;
                publishedBy: string | null;
                publishedAt: number | null;
                rollbackOf: number | null;
                document: {
                    siteConfig: {
                        [key: string]: unknown;
                    };
                    locales: {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                    mock?: {
                        [key: string]: unknown;
                    };
                };
            } | null;
        };
        putAdminConfigDraft200: {
            id: string;
            version: number;
            /** @enum {string} */
            status: "draft" | "published" | "superseded";
            configHash: string | null;
            baseVersion: number | null;
            createdBy: string;
            createdAt: number;
            publishedBy: string | null;
            publishedAt: number | null;
            rollbackOf: number | null;
        };
        putAdminConfigDraftBody: {
            baseVersion: number;
            document: {
                siteConfig: {
                    [key: string]: unknown;
                };
                locales: {
                    [key: string]: {
                        [key: string]: string;
                    };
                };
                mock?: {
                    [key: string]: unknown;
                };
            };
        };
        validateAdminConfig200: {
            errors: {
                /** @enum {string} */
                level: "error" | "warning";
                path: string;
                key: string;
                params: {
                    [key: string]: string | number | boolean;
                };
            }[];
            warnings: {
                /** @enum {string} */
                level: "error" | "warning";
                path: string;
                key: string;
                params: {
                    [key: string]: string | number | boolean;
                };
            }[];
        };
        validateAdminConfigBody: {
            document: {
                siteConfig: {
                    [key: string]: unknown;
                };
                locales: {
                    [key: string]: {
                        [key: string]: string;
                    };
                };
                mock?: {
                    [key: string]: unknown;
                };
            };
        };
        publishAdminConfig200: {
            id: string;
            version: number;
            /** @enum {string} */
            status: "draft" | "published" | "superseded";
            configHash: string | null;
            baseVersion: number | null;
            createdBy: string;
            createdAt: number;
            publishedBy: string | null;
            publishedAt: number | null;
            rollbackOf: number | null;
        };
        publishAdminConfigBody: {
            draftVersion: number;
        };
        listAdminConfigVersions200: {
            versions: {
                id: string;
                version: number;
                /** @enum {string} */
                status: "draft" | "published" | "superseded";
                configHash: string | null;
                baseVersion: number | null;
                createdBy: string;
                createdAt: number;
                publishedBy: string | null;
                publishedAt: number | null;
                rollbackOf: number | null;
            }[];
        };
        rollbackAdminConfig200: {
            id: string;
            version: number;
            /** @enum {string} */
            status: "draft" | "published" | "superseded";
            configHash: string | null;
            baseVersion: number | null;
            createdBy: string;
            createdAt: number;
            publishedBy: string | null;
            publishedAt: number | null;
            rollbackOf: number | null;
        };
        exportAdminConfigVersion200: {
            siteConfig: {
                [key: string]: unknown;
            };
            locales: {
                [key: string]: {
                    [key: string]: string;
                };
            };
            mock?: {
                [key: string]: unknown;
            };
        };
        listAdminUsers200: {
            users: {
                id: string;
                /** Format: email */
                email: string;
                name: string;
                /** @enum {string} */
                role: "user" | "trainingOfficer" | "admin";
                disabled: boolean;
                mustChangePassword: boolean;
                createdAt: number;
            }[];
        };
        createAdminUser201: {
            user: {
                id: string;
                /** Format: email */
                email: string;
                name: string;
                /** @enum {string} */
                role: "user" | "trainingOfficer" | "admin";
                disabled: boolean;
                mustChangePassword: boolean;
                createdAt: number;
            };
            temporaryPassword: string;
        };
        createAdminUserBody: {
            /** Format: email */
            email: string;
            name: string;
            /** @enum {string} */
            role: "user" | "trainingOfficer" | "admin";
        };
        disableAdminUser200: {
            user: {
                id: string;
                /** Format: email */
                email: string;
                name: string;
                /** @enum {string} */
                role: "user" | "trainingOfficer" | "admin";
                disabled: boolean;
                mustChangePassword: boolean;
                createdAt: number;
            };
            sessionsRevoked: number;
        };
        setAdminUserRole200: {
            id: string;
            /** Format: email */
            email: string;
            name: string;
            /** @enum {string} */
            role: "user" | "trainingOfficer" | "admin";
            disabled: boolean;
            mustChangePassword: boolean;
            createdAt: number;
        };
        setAdminUserRoleBody: {
            /** @enum {string} */
            role: "user" | "trainingOfficer" | "admin";
        };
        listAdminUserSessions200: {
            sessions: {
                id: string;
                createdAt: number;
                expiresAt: number;
                userAgent: string | null;
            }[];
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
    submitQuery: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["submitQueryBody"];
            };
        };
        responses: {
            /** @description Acknowledged */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["submitQuery202"];
                };
            };
            /** @description Malformed body or failed validation or plan (validationFailed, errors[]) */
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
            /** @description Query type or source not allowed for the caller (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Stale config hash (configHashMismatch, currentConfigHash) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Body over the size cap (payloadTooLarge) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Rate limited (rateLimited, Retry-After) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Internal error; nothing was acknowledged (internal) */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Shutting down or not ready (unavailable) */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAdminConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Live and draft */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["getAdminConfig200"];
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    putAdminConfigDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["putAdminConfigDraftBody"];
            };
        };
        responses: {
            /** @description Draft saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["putAdminConfigDraft200"];
                };
            };
            /** @description Malformed body (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The base is not the live version (draftConflict) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Body over the size cap (payloadTooLarge) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    validateAdminConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["validateAdminConfigBody"];
            };
        };
        responses: {
            /** @description Diagnostics */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["validateAdminConfig200"];
                };
            };
            /** @description Malformed body (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Body over the size cap (payloadTooLarge) */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    publishAdminConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["publishAdminConfigBody"];
            };
        };
        responses: {
            /** @description Published version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["publishAdminConfig200"];
                };
            };
            /** @description Malformed body or the draft fails validation (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such draft (notFound) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The draft base is not the live version (draftConflict) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAdminConfigVersions: {
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
                    "application/json": components["schemas"]["listAdminConfigVersions200"];
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    rollbackAdminConfig: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                version: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description New published version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["rollbackAdminConfig200"];
                };
            };
            /** @description Malformed version (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such version (notFound) */
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
    exportAdminConfigVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                version: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Document */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["exportAdminConfigVersion200"];
                };
            };
            /** @description Malformed version (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such version (notFound) */
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
    listAdminUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Users */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["listAdminUsers200"];
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAdminUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["createAdminUserBody"];
            };
        };
        responses: {
            /** @description Created, with the one-time password */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["createAdminUser201"];
                };
            };
            /** @description Malformed body or email already used (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    disableAdminUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Disabled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["disableAdminUser200"];
                };
            };
            /** @description Malformed id (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such user (notFound) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Would leave no enabled admin (lastAdmin) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setAdminUserRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["setAdminUserRoleBody"];
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["setAdminUserRole200"];
                };
            };
            /** @description Malformed id or body (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such user (notFound) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Would leave no enabled admin (lastAdmin) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAdminUserSessions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["listAdminUserSessions200"];
                };
            };
            /** @description Malformed id (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such user (notFound) */
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
    revokeAdminSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                sessionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Malformed session id (validationFailed) */
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
            /** @description Role not allowed, or missing X-Requested-With on a write (forbidden) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No such session (notFound) */
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
}
