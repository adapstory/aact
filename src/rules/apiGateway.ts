// TODO: API Gateway rule
//
// Проверяет, что внешние REST-вызовы проходят через API Gateway.
//
// Два варианта семантики:
//
// 1. Generic:
//    ACL-контейнеры → внешние связи → technology содержит /gateway/i
//
// 2. Strict:
//    Все контейнеры → внешние связи → technology начинается с конкретного URL шлюза
//
// Вероятный контракт:
//
// interface ApiGatewayOptions {
//   aclTag?: string;           // default: "acl"
//   externalType?: string;     // default: "System_Ext"
//   gatewayPattern?: RegExp;   // default: /gateway/i
// }
//
// function checkApiGateway(containers: Container[], options?: ApiGatewayOptions): Violation[]

export {};
