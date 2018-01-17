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

"use strict";

const URIChars = {
    'alpha': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'digit': '0123456789',
    'hexdigit': '0123456789ABCDEFabcdef',
    'genDelims': ':/?#[]@',
    'subDelims': "!$&'()*+,;="
}

URIChars.varstart = URIChars.alpha + URIChars.digit + '_';
URIChars.varchar = URIChars.varstart + '.';
URIChars.unreserved = URIChars.alpha + URIChars.digit + '-._~';
URIChars.reserved = URIChars.genDelims + URIChars.subDelims;


class URIVariable {
    constructor(name) {
        this.name = ''
        this.maxLength = null
        this.explode = false
        this.array = false

        if (-1 == URIChars.varstart.indexOf(name.slice(0, 1))) {
            throw 'Bad Variable: ' + name;
        }

        if (-1 < name.indexOf(':')) {
            let parts = name.split(':', 2);
            name = parts[0];
            let maxLength = parts[1];
            if ((0 < maxLength.length) && (maxLength.length < 4)) {
                for (let digit of maxLength) {
                    if (-1 == URIChars.digit.indexOf(digit)) {
                        throw 'Bad Variable: ' + name + ':' + maxLength;
                    }
                }
                this.maxLength = parseInt(maxLength);
                if (! this.maxLength) {
                    throw 'Bad Variable: ' + name + ':' + maxLength;
                }
            }
            else {
                throw 'Bad Variable: ' + name + ':' + maxLength;
            }
        }
        else if ('*' == name[name.length - 1]) {
            name = name.slice(0, -1);
            this.explode = true
        }
        else if ('[]' == name.slice(-2)) {
            name = name.slice(0, -2);
            this.array = true
            this.explode = true
        }

        let index = 0;
        while (index < name.length) {
            let codepoint = name[index]
            if (('%' == codepoint) &&
                ((index + 2) < name.length) &&
                (-1 < URIChars.hexdigit.indexOf(name[index + 1])) &&
                (-1 < URIChars.hexdigit.indexOf(name[index + 2]))) {
                this.name += name.slice(index, index + 3);
                index += 2;
            }
            else if (-1 < URIChars.varchar.indexOf(codepoint)) {
                this.name += codepoint;
            }
            else {
                throw 'Bad Variable: ' + name + (this.maxLength ? ':' + this.maxLength : '') +
                    (this.array ? '[]' : (this.explode ? '*' : ''));
            }
            index += 1;
        }
    }
}

class URIExpression {
    constructor() {
    }

    _encode(value, legal, pctEncoded) {
        let output = '';
        let index = 0;
        while (index < value.length) {
            let codepoint = value[index];
            if (-1 < legal.indexOf(codepoint)) {
                output += codepoint;
            }
            else if (pctEncoded && ('%' == codepoint) &&
                     ((index + 2) < value.length) &&
                     (-1 < URIChars.hexdigit.indexOf(value[index + 1])) &&
                     (-1 < URIChars.hexdigit.indexOf(value[index + 2]))) {
                output += value.slice(index, index + 3);
                index += 2;
            }
            else {
                let utf8 = unescape(encodeURIComponent(codepoint));
                for (let byte of utf8) {
                    let byteVal = byte.charCodeAt(0);
                    output += '%' + URIChars.hexdigit[parseInt(byteVal / 16)] + URIChars.hexdigit[byteVal % 16]
                }
            }
            index += 1;
        }
        return output;
    }

    _uriEncodeValue(value) {
        return this._encode(value, URIChars.unreserved, false);
    }

    _uriEncodeName(name) {
        return (name ? this._encode(name, URIChars.unreserved + URIChars.reserved, true) : '');
    }

    _join(prefix, joiner, value) {
        if ('' !== prefix) {
            return prefix + joiner + value;
        }
        return value;
    }

    _encodeStr(variable, name, value, prefix, joiner, first) {
        if (variable.maxLength) {
            if (! first) {
                throw 'Bad Expansion: ' + variable;
            }
            return this._join(prefix, joiner, this._uriEncodeValue(value.slice(0, variable.maxLength)));
        }
        return this._join(prefix, joiner, this._uriEncodeValue(value));
    }

    _encodeDictItem(variable, name, key, item, delim, prefix, joiner, first) {
        joiner = (variable.explode ? '=' : ',');
        if (variable.array) {
            prefix = ((('' !== prefix) && (! first)) ? (prefix + '[' + this._uriEncodeName(key) + ']') : this._uriEncodeName(key));
        }
        else {
            prefix = this._join(prefix, '.', this._uriEncodeName(key));
        }
        return this._encodeVar(variable, key, item, {'delim': delim, 'prefix': prefix, 'joiner': joiner, 'first': false});
    }

    _encodeListItem(variable, name, index, item, delim, prefix, joiner, first) {
        if (variable.array) {
            prefix = ('' !== prefix ? prefix + '[' + index + ']' : '');
            return this._encodeVar(variable, null, item, {'delim': delim, 'prefix': prefix, 'joiner': joiner, 'first': false});
        }
        return this._encodeVar(variable, name, item, {'delim': delim, 'prefix': prefix, 'joiner': '.', 'first': false});
    }

    _encodeVar(variable, name, value, options) {
        options = options || {};
        options.delim = options.hasOwnProperty('delim') ? options.delim : ',';
        options.prefix = options.hasOwnProperty('prefix') ? options.prefix : '';
        options.joiner = options.hasOwnProperty('joiner') ? options.joiner : '=';
        options.first = options.hasOwnProperty('first') ? options.first : true;

        if (null === value) {
            return '';
        }
        else if ('string' === typeof value) {
            return this._encodeStr(variable, name, value, options.prefix, options.joiner, options.first);
        }
        else if (Array.isArray(value)) {
            if (value.length) {
                let output = '';
                for (let index = 0; index < value.length; index++) {
                    let item = value[index];
                    let encodedItem = this._encodeListItem(variable, name, index, item, options.delim, options.prefix, options.joiner, options.first);
                    if (null !== encodedItem) {
                        if (output) {
                            output += options.delim;
                        }
                        output += encodedItem;
                    }
                }
                return output;
            }
            return null;
        }
        else if ('object' === typeof value) {
            if (Object.keys(value).length) {
                let output = '';
                for (let key in value) {
                    if (value.hasOwnProperty(key)) {
                        let encodedItem = this._encodeDictItem(variable, name, key, value[key], options.delim, options.prefix, options.joiner, options.first);
                        if (null !== encodedItem) {
                            if (output) {
                                output += options.delim;
                            }
                            output += encodedItem;
                        }
                    }
                }
                return output;
            }
            return null;
        }
        return this._encodeStr(variable, name, ('' + value).toLowerCase(), options.prefix, options.joiner, options.first);
    }

    get variables() {
        return new Set();
    }

    expand(values) {
        return null;
    }
}


class URILiteral extends URIExpression {
    constructor(value) {
        super();
        this.value = value;
    }

    expand(values) {
        return this._encode(this.value, (URIChars.unreserved + URIChars.reserved), true);
    }
}


class URIExpansion extends URIExpression {
    constructor(variables) {
        super();
        this.operator = '';
        this.varJoiner = ',';
        this.vars = [];
        let vars = variables.split(',');
        for (let variable of vars) {
            this.vars.push(new URIVariable(variable));
        }
    }

    _expandVar(variable, value) {
        return this._encodeVar(variable, this._uriEncodeName(variable.name), value);
    }

    get variables() {
        let variables = new Set();
        for (let variable of this.vars) {
            variables.add(variable.name);
        }
        return variables;
    }

    expand(values) {
        let output = null;
        for (let variable of this.vars) {
            if (values.hasOwnProperty(variable.name) && (null !== values[variable.name])) {
                let expandedVar = this._expandVar(variable, values[variable.name]);
                if (null !== expandedVar) {
                    if (null === output) {
                        output = '';
                    }
                    if (output) {
                        output += this.varJoiner;
                    }
                    output += expandedVar;
                }
            }
        }
        if (null !== output) {
            return this.operator + output;
        }
        return null;
    }
}


class URISimpleExpansion extends URIExpansion {
}


class URIReservedExpansion extends URIExpansion {
    constructor(variables) {
        super(variables.slice(1));
    }

    _uriEncodeValue(value) {
        return this._encode(value, (URIChars.unreserved + URIChars.reserved), true)
    }
}


class URIFragmentExpansion extends URIReservedExpansion {
    constructor(variables) {
        super(variables);
        this.operator = '#';
    }
}


class URILabelExpansion extends URIExpansion {
    constructor(variables) {
        super(variables.slice(1));
        this.operator = '.';
        this.varJoiner = '.';
    }

    _expandVar(variable, value) {
        return this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': (variable.explode ? '.' : ',')});
    }
}


class URIPathExpansion extends URIExpansion {
    constructor(variables) {
        super(variables.slice(1));
        this.operator = '/';
        this.varJoiner = '/';
    }

    _expandVar(variable, value) {
        return this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': (variable.explode ? '/' : ',')});
    }
}


class URIPathStyleExpansion extends URIExpansion {
    constructor(variables) {
        super(variables.slice(1));
        this.operator = ';';
        this.varJoiner = ';';
    }

    _encodeStr(variable, name, value, prefix, joiner, first) {
        if (variable.array) {
            if ('' !== name) {
                prefix = ('' !== prefix ? prefix + '[' + name + ']' : name);
            }
        }
        else if (variable.explode) {
            prefix = this._join(prefix, '.', name);
        }
        return super._encodeStr(variable, name, value, prefix, joiner, first);
    }

    _encodeDictItem(variable, name, key, item, delim, prefix, joiner, first) {
        if (variable.array) {
            if ('' !== name) {
                prefix = ('' !== prefix ? prefix + '[' + name + ']' : name);
            }
            prefix = ((('' !== prefix) && (! first)) ? (prefix + '[' + this._uriEncodeName(key) + ']') : this._uriEncodeName(key));
        }
        else if (variable.explode) {
            prefix = ((! first) ? this._join(prefix, '.', name) : '');
        }
        else {
            prefix = this._join(prefix, '.', this._uriEncodeName(key));
            joiner = ',';
        }
        return this._encodeVar(variable, ((! variable.array) ? this._uriEncodeName(key) : ''), item,
                               {'delim': delim, 'prefix': prefix, 'joiner': joiner, 'first': false});
    }

    _encodeListItem(variable, name, index, item, delim, prefix, joiner, first) {
        if (variable.array) {
            if ('' !== name) {
                prefix = ('' !== prefix ? prefix + '[' + name + ']' : name);
            }
            return this._encodeVar(variable, index, item,
                                   {'delim': delim, 'prefix': prefix, 'joiner': joiner, 'first': false});
        }
        return this._encodeVar(variable, name, item,
                               {'delim': delim, 'prefix': prefix, 'joiner': (variable.explode ? '=' : '.'), 'first': false});
    }

    _expandVar(variable, value) {
        if (variable.explode) {
            return this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': ';'});
        }
        value = this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': ','});
        return (value ? (this._uriEncodeName(variable.name) + '=' + value) : variable.name);
    }
}


class URIFormStyleQueryExpansion extends URIPathStyleExpansion {
    constructor(variables) {
        super(variables);
        this.operator = '?';
        this.varJoiner = '&';
    }

    _expandVar(variable, value) {
        if (variable.explode) {
            return this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': '&'});
        }
        value = this._encodeVar(variable, this._uriEncodeName(variable.name), value, {'delim': ','});
        return ((null !== value) ? (this._uriEncodeName(variable.name) + '=' + value) : null);
    }
}


class URIFormStyleQueryContinuation extends URIFormStyleQueryExpansion {
    constructor(variables) {
        super(variables);
        this.operator = '&';
    }
}


export class URITemplate {
    constructor(template) {
        this.template = template;
        this.parts = [];

        let parts = this.template.split(/(\{[^\}]*\})/)
        for (let part of parts) {
            if (part.startsWith('{') && part.endsWith('}')) {
                let expression = part.slice(1, -1);
                if (expression.match(/^([a-zA-Z0-9_]|%[0-9a-fA-F][0-9a-fA-F]).*$/)) {
                    this.parts.push(new URISimpleExpansion(expression));
                }
                else if ('+' == part[1]) {
                    this.parts.push(new URIReservedExpansion(expression));
                }
                else if ('#' == part[1]) {
                    this.parts.push(new URIFragmentExpansion(expression));
                }
                else if ('.' == part[1]) {
                    this.parts.push(new URILabelExpansion(expression));
                }
                else if ('/' == part[1]) {
                    this.parts.push(new URIPathExpansion(expression))
                }
                else if (';' == part[1]) {
                    this.parts.push(new URIPathStyleExpansion(expression))
                }
                else if ('?' == part[1]) {
                    this.parts.push(new URIFormStyleQueryExpansion(expression))
                }
                else if ('&' == part[1]) {
                    this.parts.push(new URIFormStyleQueryContinuation(expression))
                }
                else if (part[1] in {'=':'', ',':'', '!':'', '@':'', '|':''}) {
                    throw 'Unsupported Expression: ' + part;
                }
                else {
                    throw 'Bad Expression: ' + part;
                }
            }
            else {
                if (! (part.includes('{') || part.includes('}'))) {
                    this.parts.push(new URILiteral(part));
                }
                else {
                    throw 'Bad Expression: ' + part;
                }
            }
        }
    }


    get variables() {
        let variables = new Set();
        for (let part of this.parts) {
            for (let variable of part.variables) {
                variables.add(variable);
            }
        }
        return variables;
    }


    expand(values) {
        let output = '';
        try {
            for (let part of this.parts) {
                let expanded = part.expand(values);
                if (null !== expanded) {
                    output += expanded;
                }
            }
        }
        catch (err) {
            return false;
        }
        return output;
    }
}

