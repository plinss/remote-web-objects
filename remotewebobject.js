/*******************************************************************************
 *
 *  Copyright © 2016-2018 Peter Linss
 *
 *  This work is distributed under the W3C® Software License [1]
 *  in the hope that it will be useful, but WITHOUT ANY
 *  WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 *  [1] https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document
 *
 ******************************************************************************/

'use strict';

import {URITemplate} from "./uritemplate.js";

class RemoteEvent {
    constructor(serverEvent, target) {
        Object.defineProperty(this, 'type', { enumerable: true, get: () => serverEvent.type });
        Object.defineProperty(this, 'target', { enumerable: true, get: () => target });
        Object.defineProperty(this, 'timeStamp', { enumerable: true, get: () => serverEvent.timeStamp });
        Object.defineProperty(this, 'id', { enumerable: true, get: () => serverEvent.id });

        try {
            let data = JSON.parse(serverEvent.data)
            if ('object' === typeof data) {
                for (let key in data) {
                    if (data.hasOwnProperty(key) && (! this.hasOwnProperty(key))) {
                        Object.defineProperty(this, key, { enumerable: true, get: () => data[key] });
                    }
                }
            }
            if (! this.hasOwnProperty('data')) {
                Object.defineProperty(this, 'data', { enumerable: true, get: () => data });
            }
        }
        catch (err) {
            Object.defineProperty(this, 'data', { enumerable: true, get: () => serverEvent.data });
        }

        this.__proto__.__proto__ = Event.prototype;
    }

    get bubbles() { return false; }
    get cancelBubble() { return false; }
    set cancelBubble(value) {}
    get cancelable() { return false; }
    get composed() { return false; }
    get currentTarget() { return this.target; }
    get defaultPrevented() { return false; }
    get eventPhase() { return Event.AT_TARGET };

    initEvent() {}
    preventDefault() {}
    stopImmediatePropagation() {}
    stopPropagation() {}
}


class RemoteWebEventTarget extends EventTarget {
}

class RemoteWebObject {

    static async Fetch(url, options) {
        let callOptions = {
            credentials: (options && options.hasOwnProperty('credentials') ? options.credentials : 'omit'),
        };
        let headers = {
            Accept: options && options.hasOwnProperty('version') ? 'application/' + options.version + '+json-remote' : 'application/json-remote',
        };
        if (options && options.hasOwnProperty('username') && options.hasOwnProperty('password')) {
            callOptions.headers.Authorization = 'Basic ' + btoa(auth.username + ':' + auth.password);
            headers.Authorization = callOptions.headers.Authorization;
        }

        let response = await fetch(url, {
            method: 'get',
            headers: headers,
            credentials: callOptions.credentials,
        });

        return new RemoteWebObject(response.url, await response.json(), callOptions);
    }


    constructor(baseURL, apiHome, callOptions) {
        let privateState = {};
        let readOnlyState = {};
        let self = this;

        function addReadOnlyGetter(container, key) {
            if ((readOnlyState === container) && (! self.hasOwnProperty(key))) {
                Object.defineProperty(self, key, { configurable: true, enumerable: true, get: () => readOnlyState[key] });
            }
        }

        function removeReadOnlyGetter(container, key) {
            if (readOnlyState === container) {
                delete self[key];
            }
        }

        // capture state
        if (apiHome.hasOwnProperty('state')) {
            if (apiHome.state.hasOwnProperty('private')) {
                for (let attr in apiHome.state.private) {
                    if (apiHome.state.private.hasOwnProperty(attr)) {
                        privateState[attr] = apiHome.state.private[attr];
                    }
                }
            }

            if (apiHome.state.hasOwnProperty('readonly')) {
                for (let attr in apiHome.state.readonly) {
                    if (apiHome.state.readonly.hasOwnProperty(attr) &&
                        (! privateState.hasOwnProperty(attr))) {
                        readOnlyState[attr] = apiHome.state.readonly[attr];
                        addReadOnlyGetter(readOnlyState, attr);
                    }
                }
            }

            if (apiHome.state.hasOwnProperty('public')) {
                for (let attr in apiHome.state.public) {
                    if (apiHome.state.public.hasOwnProperty(attr) &&
                        (! self.hasOwnProperty(attr)) &&
                        (! privateState.hasOwnProperty(attr))) {
                        self[attr] = apiHome.state.public[attr];
                    }
                }
            }
        }

        if (! apiHome.hasOwnProperty('resources')) {
            return;
        }

        let resources = apiHome.resources;

        function matchArguments(func, args, object) {
            let argObject = {};

            if (func && func.hasOwnProperty('defaults')) {    // capture defaults
                for (let defaultName in func.defaults) {
                    if (func.defaults.hasOwnProperty(defaultName)) {
                        argObject[defaultName] = func.defaults[defaultName];
                    }
                }
            }
            for (let key in object) {
                if (object.hasOwnProperty(key) && ('function' !== typeof object[key])) {
                    argObject[key] = object[key];
                }
            }
            for (let key in readOnlyState) {
                if (readOnlyState.hasOwnProperty(key)) {
                    argObject[key] = readOnlyState[key];
                }
            }
            for (let key in privateState) {
                if (privateState.hasOwnProperty(key)) {
                    argObject[key] = privateState[key];
                }
            }
            if (args && func && func.hasOwnProperty('arguments')) {    // capture function arguments
                for (let index = 0; (index < func.arguments.length) && (index < args.length); index++) {
                    if ('...' == func.arguments[index]) {
                        argObject['...'] = args.slice(index);
                        break;
                    }
                    else {
                        argObject[func.arguments[index]] = args[index];
                    }
                }
            }
            return argObject;
        }

        function flattenData(output, value, name) {
            if (null === value) {
                return output;
            }
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index++) {
                    flattenData(output, value[index], name + '[' + index + ']');
                }
            }
            else if ('object' === typeof value) {
                for (let key in value) {
                    if (value.hasOwnProperty(key)) {
                        flattenData(output, value[key], (name ? name + '[' + key + ']' : key));
                    }
                }
            }
            else if ('string' === typeof value) {
                output[name] = value;
            }
            else {
                output[name] = '' + value;
            }
            return output;
        }

        function getFormData(data) {
            let formData = new FormData();
            for (let key in data) {
                if (data.hasOwnProperty(key)) {
                    formData.append(key, data[key]);
                }
            }
            return formData;
        }

        function applyPatch(patch) {
            for (let operation of patch) {
                if ((! operation.hasOwnProperty('op')) || (! operation.hasOwnProperty('path'))) {
                    return false;
                }
            }

            let returnContainer = {return: null};

            function performPatchOperation(path, op, data) {
                function unescapeJsonPath(path) {
                    path = path.replace('~1', '/');
                    return path.replace('~0', '~');
                }

                if ((! path) || ('/' != path[0])) {   // invalid path
                    return false;
                }
                let parts = path.split('/').slice(1);
                if ((parts.length < 1) || ((parts.length < 2) && ('return' != parts[0]))) {   // invalid path
                    return false;
                }
                if (data.hasOwnProperty('from')) {
                    let fromParts = data.from.split('/');
                    if ((! data.from) || ('/' != data.from[0]) || (fromParts.length < 2)) { // invalid from
                        return false;
                    }
                    if ((2 == parts.length) && (2 == fromParts.length)) {   // operation on top level members
                        if (('copy' == op) && (parts[1] == fromParts[1])) { // can't copy to top level with same name
                           return false;
                        }
                    }
                }

                let firstPart = unescapeJsonPath(parts.splice(0, 1)[0]);
                let container = null;
                switch (firstPart) {
                    case 'public': container = self; break;
                    case 'private': container = privateState; break;
                    case 'readonly': container = readOnlyState; break;
                    case 'return': container = returnContainer; parts.splice(0, 0, firstPart); break;
                    default: return false;
                }

                let lastPart = unescapeJsonPath(parts.pop());
                for (let part of parts) {
                    part = unescapeJsonPath(part);
                    if (Array.isArray(container)) {
                        let index = parseInt(part);
                        if ((-1 < index) && (index < container.length)) {
                            container = container[part];
                        }
                        else {
                            return false;
                        }
                    }
                    else if ('object' === typeof container) {
                        if (container.hasOwnProperty(part)) {
                            container = container[part];
                        }
                        else {
                            return false;
                        }
                    }
                    else {
                        return false;
                    }
                }
                if (Array.isArray(container)) {
                    let index = parseInt(lastPart);
                    if ('add' == op) {
                        if (data.hasOwnProperty('value')) {
                            if ('-' == lastPart) {
                                container.push(data.value);
                                return true;
                            }
                            else if ((-1 < index) && (index < container.length)) {
                                container.splice(index, 0, data.value);
                                return true;
                            }
                        }
                    }
                    else if ((-1 < index) && (index < container.length)) {
                        if ('remove' == op) {
                            container.splice(index, 1);
                            return true;
                        }
                        else if ('replace' == op) {
                            if (data.hasOwnProperty('value')) {
                                container.splice(index, 1, data.value);
                                return true;
                            }
                        }
                        else if ('move' == op) {
                            if (data.hasOwnProperty('from')) {
                                return performPatchOperation(data.from, 'move-from', { container: container, index: index });
                            }
                        }
                        else if ('move-from' == op) {
                            let value = container.splice(index, 1);
                            if (Array.isArray(data.container)) {
                                if ('-' == data.index) {
                                    data.container.push(value[0]);
                                }
                                else {
                                    data.container.splice(data.index, 0, value[0]);
                                }
                            }
                            else {
                                data.container[data.index] = value[0];
                                addReadOnlyGetter(data.container, data.index);
                            }
                            return true;
                        }
                        else if ('copy' == op) {
                            if (data.hasOwnProperty('from')) {
                                return performPatchOperation(data.from, 'copy-from', { container: container, index: index });
                            }
                        }
                        else if ('copy-from' == op) {
                            let value = container[index];
                            if (Array.isArray(data.container)) {
                                if ('-' == data.index) {
                                    data.container.push(value);
                                }
                                else {
                                    data.container.splice(data.index, 0, value);
                                }
                            }
                            else {
                                data.container[data.index] = value;
                                addReadOnlyGetter(data.container, data.index);
                            }
                            return true;
                        }
                        else if ('test' == op) {
                            if (data.hasOwnProperty('value')) {
                                return (container[index] == data.value);
                            }
                        }
                    }
                }
                else if ('object' == typeof container) {
                    if ('add' == op) {
                        if (data.hasOwnProperty('value')) {
                            container[lastPart] = data.value;
                            addReadOnlyGetter(container, lastPart);
                            return true;
                        }
                    }
                    else if (container.hasOwnProperty(lastPart)) {
                        if ('remove' == op) {
                            removeReadOnlyGetter(container, lastPart);
                            return delete container[lastPart];
                        }
                        else if ('replace' == op) {
                            if (data.hasOwnProperty('value')) {
                                container[lastPart] = data.value;
                                return true;
                            }
                        }
                        else if ('move' == op) {
                            if (data.hasOwnProperty('from')) {
                                return performPatchOperation(data.from, 'move-from', { container: container, index: lastPart });
                            }
                        }
                        else if ('move-from' == op) {
                            let value = container[lastPart];
                            if (delete container[lastPart]) {
                                removeReadOnlyGetter(container, lastPart);
                                if (Array.isArray(data.container)) {
                                    if ('-' == data.index) {
                                        data.container.push(value);
                                    }
                                    else {
                                        data.container.splice(data.index, 0, value);
                                    }
                                }
                                else {
                                    data.container[data.index] = value;
                                    addReadOnlyGetter(data.container, data.index);
                                }
                                return true;
                            }
                        }
                        else if ('copy' == op) {
                            if (data.hasOwnProperty('from')) {
                                return performPatchOperation(data.from, 'copy-from', { container: container, index: lastPart });
                            }
                        }
                        else if ('copy-from' == op) {
                            let value = container[lastPart];
                            if (Array.isArray(data.container)) {
                                if ('-' == index) {
                                    data.container.push(value);
                                }
                                else {
                                    data.container.splice(data.index, 0, value);
                                }
                            }
                            else {
                                data.container[data.index] = value;
                                addReadOnlyGetter(data.container, data.index);
                            }
                            return true;
                        }
                        else if ('test' == op) {
                            if (data.hasOwnProperty('value')) {
                                return (container[lastPart] == data.value);
                            }
                        }
                    }
                }
                return false;
            }

            for (let operation of patch) {
                if (! performPatchOperation(operation.path, operation.op, operation)) {
                    throw 'patch operation failed: ' + operation;
                }
            }
            return returnContainer.return;
        }

        async function rpcCall(object, resourceName, functionName, args) {
            console.log('calling', resourceName + ':' + functionName);

            let resource = resources[resourceName];
            let hints = (resource.hasOwnProperty('hints') ? resource.hints : {});
            let func = resources[resourceName].functions[functionName];
            let format = 'application/json';

            if (func.hasOwnProperty('format')) {
                format = func.format;
            }
            else if (hints.hasOwnProperty('formats') && Array.isArray(hints.formats) && (0 < hints.formats.length)) {
                format = hints.formats[0];
            }

            let argObject = matchArguments(func, args, object);
            let url = new URL(resource.uriTemplate ? resource.uriTemplate.expand(argObject) : resource.href, baseURL);

            if (url.href) {
                let method = 'GET';
                let headers = Object.assign({}, callOptions.headers);
                headers.Accept = format;

                if (func.hasOwnProperty('method')) {
                    method = func.method.toUpperCase();
                }
                else if (hints.hasOwnProperty('allow') && Array.isArray(hints.allow) && (0 < hints.allow.length)) {
                    method = hints.allow[0];
                }

                let requestBody = null;
                if (('POST' == method) || ('PUT' == method)) {
                    if (resource.uriTemplate) {    // remove data sent in uri
                        let variables = resource.uriTemplate.variables;
                        variables.forEach((variable) => {
                            delete argObject[variable];
                        });
                    }
                    if (func.hasOwnProperty('requestBody')) {    // limit request body to specified variables
                        let requestArgs = {};
                        for (let varName of func.requestBody) {
                            if (argObject.hasOwnProperty(varName)) {
                                requestArgs[varName] = argObject[varName];
                            }
                        }
                        argObject = requestArgs;
                    }
                    let requestFormat;
                    if (func.hasOwnProperty('requestFormat')) {
                        requestFormat = func.requestFormat;
                    }
                    else {
                        if ('POST' == method) {
                            if (hints.hasOwnProperty('acceptPost') && Array.isArray(hints.acceptPost) && (0 < hints.acceptPost.length)) {
                                requestFormat = hints.acceptPost[0];
                            }
                            else {
                                requestFormat = 'multipart/form-data';
                            }
                        }
                        else {
                            if (hints.hasOwnProperty('acceptPut') && Array.isArray(hints.acceptPut) && (0 < hints.acceptPut.length)) {
                                requestFormat = hints.acceptPut[0];
                            }
                            else {
                                requestFormat = 'application/json';
                            }
                        }
                    }

                    if ('application/x-www-form-urlencoded' == requestFormat) {
                        requestBody = new URLSearchParams(flattenData({}, argObject));
                    }
                    else if ('multipart/form-data' == requestFormat) {
                        requestBody = getFormData(flattenData({}, argObject));
                    }
                    else if (requestFormat.endsWith('/json') || requestFormat.endsWith('+json')) {
                        headers['Content-Type'] = requestFormat;
                        requestBody = JSON.stringify(argObject);
                    }
                    else {
                        throw 'unhandled request format';
                    }
                }

                let response = await fetch(url.href, {
                    method: method,
                    headers: headers,
                    credentials: callOptions.credentials,
                    body: requestBody,
                });

                if (response.headers.has('content-type')) {
                    let responseType = response.headers.get('content-type').split(';')[0];
                    if ('application/json-patch+json' == responseType) {
                        return applyPatch(await response.json());
                    }
                    else if (responseType.endsWith('/json') || responseType.endsWith('+json')) {
                        return await response.json();
                    }
                    else if (responseType.endsWith('/json-remote') || responseType.endsWith('+json-remote')) {
                        return new RemoteWebObject(url.href, await response.json(), callOptions);
                    }
                    // XXX parse other types? (need to sepcify type in function?)
                }
                return await response.text();
            }
            else {
                throw 'No URL specified for function';
            }
        }

        function makeRPCFunction(resourceName, functionName) {
            return function () {
                return rpcCall(this, resourceName, functionName, arguments);
            };
        }

        // create rpc functions and event listener properties
        let eventResources = {};
        let eventListeners = {};
        let onEventListeners = {};
        for (let resourceName in resources) {
            if (resources.hasOwnProperty(resourceName)) {
                let resource = resources[resourceName];
                resource.uriTemplate = (resource.hasOwnProperty('hrefTemplate') ? new URITemplate(resource.hrefTemplate) : null);

                if (resource.hasOwnProperty('functions')) {
                    for (let functionName in resource.functions) {
                        if (resource.functions.hasOwnProperty(functionName) && (! self.hasOwnProperty(functionName))) {
                            console.log('resource', resourceName, 'has function', functionName + '(' +
                                (resource.functions[functionName].hasOwnProperty('arguments') ? resource.functions[functionName].arguments.join(', ') : '') + ')');
                            self[functionName] = makeRPCFunction(resourceName, functionName);
                        }
                    }
                }

                if (resource.hasOwnProperty('events')) {
                    resource.eventListenerCount = 0;
                    for (let eventType in resource.events) {
                        if (resource.events.hasOwnProperty(eventType) && (! eventResources.hasOwnProperty(eventType))) {
                            console.log('resource', resourceName, 'has event', eventType);
                            eventResources[eventType] = resource;
                            Object.defineProperty(self, 'on' + eventType, {
                                configurable: true,
                                enumerable: true,
                                get: () => { onEventListeners[eventType] },
                                set: (callback) => {
                                    if (onEventListeners.hasOwnProperty(eventType)) {
                                        self.removeEventListener(eventType, onEventListeners[eventType]);
                                        delete onEventListeners[eventType];
                                    }
                                    if (callback && ('function' === typeof callback)) {
                                        onEventListeners[eventType] = callback;
                                        self.addEventListener(eventType, callback);
                                    }
                                },
                            });
                        }
                    }
                }
            }
        }

        // add EventTarget mixin if events are defined
        if (Object.keys(eventResources).length) {
            self.addEventListener = function(eventType, callback, options) {
                if (callback && ('function' === typeof callback)) {
                    let resource = eventResources[eventType];
                    if (! resource.eventSource) {
                        let event = resource.events[eventType];
                        let argObject = matchArguments(event, null, self);
                        let url = new URL(resource.uriTemplate ? resource.uriTemplate.expand(argObject) : resource.href, baseURL);
                        if (url.href) {
                            resource.eventSource = new EventSource(url.href, {withCredentials: 'omit' != callOptions.credentials});
                        }
                    }
                    if (resource.eventSource) {
                        if (! eventListeners.hasOwnProperty(eventType)) {
                            eventListeners[eventType] = [];
                        }
                        let listener = function(serverEvent) {
                            callback.call(self, new RemoteEvent(serverEvent, self));
                        }
                        listener.callback = callback;
                        eventListeners[eventType].push(listener);
                        resource.eventSource.addEventListener(eventType, listener, options);
                        resource.eventListenerCount++;
                    }
                }
            };
            self.removeEventListener = function(eventType, callback, options) {
                if (callback && ('function' === typeof callback)) {
                    let resource = eventResources[eventType];
                    if (resource.eventSource) {
                        let listeners = eventListeners[eventType];
                        for (let index = 0; index < listeners.length; index++) {
                            if (callback == listeners[index].callback) {
                                resource.eventSource.removeEventListener(eventType, listeners[index], options);
                                listeners.splice(index, 1);
                                break;
                            }
                        }
                        if (0 == --resource.eventListenerCount) {
                            resource.eventSource.close();
                            resource.eventSource = null;
                        }
                    }
                }
            };
            self.dispatchEvent = function(event) {
                if (event && eventListeners.hasOwnProperty(event.type)) {
                    let listeners = eventListeners[event.type];
                    for (let index = 0; index < listeners.length; index++) {
                        listeners[index].callback.call(event);  // not setting proper target
                    }
                }
                return true;
            };
            self.__proto__ = RemoteWebEventTarget.prototype;
        }
    }

}


if (('function' !== typeof Window.prototype.fetchRemoteObject) &&
    (('function' !== typeof Window.prototype.fetchRemoteObjectPolyfill))) {
    console.log('Enabling polyfill for fetchRemoteObject');
    Window.prototype.fetchRemoteObjectPolyfill = RemoteWebObject.Fetch;
}
