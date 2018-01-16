/*******************************************************************************
 *
 *  Copyright © 2016 Peter Linss
 *
 *  This work is distributed under the W3C® Software License [1]
 *  in the hope that it will be useful, but WITHOUT ANY
 *  WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *
 *  [1] http://www.w3.org/Consortium/Legal/2002/copyright-software-20021231
 *
 ******************************************************************************/

"use strict";

class RemoteWebAPI {

    static Open(url, options, auth) {
        return new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();

            xhr.onreadystatechange = () => {
                if (4 == xhr.readyState) {
                    try {
                        resolve(new RemoteWebAPI(xhr.response, auth));
                    }
                    catch (err) {
                        reject(err);
                    }
                }
            };

            try {
                xhr.open('GET', url, true,
                         auth && auth.hasOwnProperty('username') ? auth.username : null,
                         auth && auth.hasOwnProperty('password') ? auth.password : null);
                if (options && options.hasOwnProperty('version')) {
                    xhr.setRequestHeader('Accept', 'application/' + options.version + '+json-api');
                }
                else {
                    xhr.setRequestHeader('Accept', 'application/json-api');
                }
                xhr.withCredentials = (auth && auth.hasOwnProperty('withCredentials') ? auth.withCredentials : false);
                xhr.responseType = 'json';
                xhr.send();
            }
            catch (err) {
                reject(err);
            }
        });
    }


    constructor(apiHome, auth) {
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

            if (func.hasOwnProperty('defaults')) {    // capture defaults
                for (let defaultName in func.defaults) {
                    if (func.defaults.hasOwnProperty(defaultName)) {
                        argObject[defaultName] = func.defaults[defaultName];
                    }
                }
            }
            for (let key in object) {
                if (object.hasOwnProperty(key)) {
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
            if (func.hasOwnProperty('arguments')) {    // capture function arguments
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

        function addFormData(formData, value, name) {
            if (null === value) {
                return;
            }
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index++) {
                    addFormData(formData, value[index], name + '[' + index + ']');
                }
            }
            else if ('object' === typeof value) {
                for (let key in value) {
                    if (value.hasOwnProperty(key)) {
                        addFormData(formData, value[key], (name ? name + '[' + key + ']' : key));
                    }
                }
            }
            else if ('string' === typeof value) {
                formData.append(name, value);
            }
            else {
                formData.append(name, '' + value);
            }
        }

        function unescapeJsonPath(path) {
            path = path.replace('~1', '/');
            return path.replace('~0', '~');
        }

        function performPatchOperation(path, op, data) {
            let parts = path.split('/').slice(1);
            if ((! path) || ('/' != path[0]) || (parts.length < 2)) {   // invalid path
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
            let container = (("private" == firstPart) ? privateState :
                             (("readonly" == firstPart) ? readOnlyState : self));
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

        function applyPatch(patch) {
            for (let operation of patch) {
                if ((! operation.hasOwnProperty('op')) || (! operation.hasOwnProperty('path'))) {
                    return false;
                }
            }
            for (let operation of patch) {
                if (! performPatchOperation(operation.path, operation.op, operation)) {
                    console.log("patch operation failed: " + operation);
                    return false;
                }
            }
            return true;
        }

        function rpcCall(object, resourceName, functionName, args) {
            return new Promise((resolve, reject) => {
                console.log('calling ' + resourceName + ':' + functionName);
                let resource = resources[resourceName];
                let func = resources[resourceName]['functions'][functionName];
                let format = func['format'] || 'application/json';

                let xhr = new XMLHttpRequest();

                xhr.onreadystatechange = () => {
                    if (4 == xhr.readyState) {
                        if (200 == xhr.status) {
                            try {    // need to use format here because we don't have access to response contentType in xhr
                                if ('application/json-patch+json' == format) {
                                    applyPatch(JSON.parse(xhr.response));
                                    resolve();
                                }
                                else if (format.endsWith('/json') || format.endsWith('+json')) {    // XXX determine from format or specify explicitly in function?
                                    resolve(JSON.parse(xhr.response));
                                }
                                else if (format.endsWith('/json-api') || format.endsWith('+json-api')) {
                                    resolve(new RemoteWebAPI(JSON.parse(xhr.response)));
                                }
                                else {
                                    resolve(xhr.response);    // XXX parse other types? (need to sepcify type in function?)
                                }
                            }
                            catch (err) {
                                reject(err);
                            }
                        }
                        else {
                            reject(xhr.responseText);
                        }
                    }
                };

                try {
                    let argObject = matchArguments(func, args, object);
                    let url = (resource.uriTemplate ? resource.uriTemplate.expand(argObject) : (resource.hasOwnProperty('href') ? resource.href : null));

                    if (url) {
                        console.log('xhr to ' + url);
                        let method = (func.hasOwnProperty('method') ? func.method.toUpperCase() : 'GET');
                        xhr.open(method, url, true,
                                 (auth && auth.hasOwnProperty('username') ? auth.username : null),
                                 (auth && auth.hasOwnProperty('password') ? auth.password : null));
                        xhr.withCredentials = (auth && auth.hasOwnProperty('withCredentials') ? auth.withCredentials : false);
                        xhr.setRequestHeader('Accept', format);

                        if (('POST' == method) || ('PUT' == method)) {
                            if (resource.uriTemplate) {    // remove data sent in uri
                                let variables = resource.uriTemplate.variables;
                                variables.forEach((variable) => {
                                    delete argObject[variable];
                                });
                            }
                            if (func.hasOwnProperty('request-body')) {    // limit request body to specified variables
                                let requestArgs = {};
                                for (let varName of func['request-body']) {
                                    if (argObject.hasOwnProperty(varName)) {
                                        requestArgs[varName] = argObject[varName];
                                    }
                                }
                                argObject = requestArgs;
                            }
                            if (func.hasOwnProperty('request-format')) {
                                xhr.setRequestHeader('Content-Type', func['request-format']);

                                if (('application/x-www-form-urlencoded' == func['request-format']) ||
                                    ('multipart/form-data' == func['request-format'])) {
                                    let formData = new FormData();
                                    addFormData(formData, argObject);
                                    if ('application/x-www-form-urlencoded' == func['request-format']) {
                                        let data = '';
                                        for (let entry of formData) {
                                            if (data) {
                                                data += '&';
                                            }
                                            data += encodeURIComponent(entry[0]) + '=' + encodeURIComponent(entry[1]);
                                        }
                                        xhr.send(data);
                                    }
                                    else {
                                        xhr.send(formData);
                                    }
                                }
                                else if (func['request-format'].endsWith('/json') || func['request-format'].endsWith('+json')) {
                                    xhr.send(JSON.stringify(argObject));
                                }
                                else {
                                    throw "unhandled request format";
                                }
                            }
                            else {    // XXX default to POST=form/PUT=json or default to format?
                                if ('POST' == method) {
                                    let formData = new FormData();
                                    addFormData(formData, argObject);
                                    xhr.send(formData);
                                }
                                else {
                                    xhr.setRequestHeader('Content-Type', 'application/json');
                                    xhr.send(JSON.stringify(argObject));
                                }
                            }
                        }
                        else {
                            xhr.send();
                        }
                    }
                    else {
                        reject('No URL specified for function');
                    }
                }
                catch (err) {
                    reject(err);
                }
            });
        }

        function makeRpcFunction(resourceName, functionName) {
            return function () {
                return rpcCall(this, resourceName, functionName, arguments);
            };
        }

        // create rpc functions
        for (let resourceName in resources) {
            if (resources.hasOwnProperty(resourceName)) {
                let resource = resources[resourceName];
                if (resource.hasOwnProperty('functions')) {
                    resource.uriTemplate = (resource.hasOwnProperty('href-template') ? new URITemplate(resource['href-template']) : null);

                    for (let functionName in resource.functions) {
                        if (resource.functions.hasOwnProperty(functionName)) {
                            console.log('resource ' + resourceName + ' has function ' + functionName + '(' +
                                (resource.functions[functionName].hasOwnProperty('arguments') ? resource.functions[functionName].arguments.join(', ') : '') + ')');
                            self[functionName] = makeRpcFunction(resourceName, functionName);
                        }
                    }
                }
            }
        }
    }

}


if (undefined === this.OpenAPI) {
    this.openAPI = RemoteWebAPI.Open;
}
