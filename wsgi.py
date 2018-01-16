#!/usr/bin/python3

from wsgiref.simple_server import make_server
from wsgiref import util
from urllib import parse
import cgi

from passlib import hash
import hashlib
import zlib
import json
import io

def application(env, start_response):
    def sendJson(obj, contentType = 'application/json'):
        start_response('200 OK', [('Content-Type', 'application/json')])    #contentType)])
        return [json.dumps(obj, indent = '  ', sort_keys = True).encode('utf-8')]

    def sendError(code, message):
        start_response(code, [('Content-Type', 'text/plain')])
        return [str(message).encode('utf-8')]

#    return dump(env, start_response)

    args = parse.parse_qs(env['QUERY_STRING'])
    def arg(key):
        if (key in args):
            return args[key][0]
        return None
    def intarg(key):
        if (key in args):
            try:
                return int(args[key][0])
            except (ValueError):
                pass
        return None

    requestURI = util.request_uri(env)
    applicationURI = util.application_uri(env)
    requestMethod = env.get('REQUEST_METHOD', 'GET').upper()
    requestContentType, requestContentArgs = cgi.parse_header(env.get('CONTENT_TYPE'))
    requestEncoding = requestContentArgs.get('encoding', 'utf-8')
    acceptContentType = env.get('HTTP_ACCEPT')

    try:
        requestContentLength = int(env.get('CONTENT_LENGTH', 0))
    except (ValueError):
        requestContentLength = 0
    requestBody = env['wsgi.input'].read(requestContentLength).decode(requestEncoding)

    if (requestContentType.endswith('/json') or requestContentType.endswith('+json')):
        requestData = json.loads(requestBody)
    elif ('application/x-www-form-urlencoded' == requestContentType):
        requestData = parse.parse_qs(requestBody)
    elif ('multipart/form-data' == requestContentType):
        if ('boundary' in requestContentArgs):
            requestContentArgs['boundary'] = requestContentArgs['boundary'].encode('ascii')
        requestData = cgi.parse_multipart(io.BytesIO(requestBody.encode(requestEncoding)), requestContentArgs)
    else:
        requestData = {}

    def request(key):
        value = requestData.get(key)
        if (not isinstance(value, str) and hasattr(value, '__getitem__')):
            value = value[0]
            if (isinstance(value, bytes)):
                value = value.decode(requestEncoding)
        return value
    def requestInt(key):
        value = request(key)
        if (value is not None):
            try:
                return int(value)
            except (ValueError):
                pass
        return None

#    print(requestContentType)
#    print(requestEncoding)
#    print(repr(requestData))
#    print(repr(args))

    path = util.shift_path_info(env)
    if ('demo' == path):
        path = util.shift_path_info(env)
        if ('password' == path):
            if ('algorithm' in args):
                cleartext = arg('cleartext')
                if (not cleartext):
                    return sendError('400 Bad Request', 'No cleartext specified')

                try:
                    if ('md5_crypt' in args['algorithm']):
                        return sendJson(hash.md5_crypt.encrypt(cleartext, salt = arg('salt')))
                    elif ('bcrypt' in args['algorithm']):
                        return sendJson(hash.bcrypt.encrypt(cleartext, salt = arg('salt'), rounds = intarg('rounds'), ident = '2b'))
                    elif ('sha1_crypt' in args['algorithm']):
                        return sendJson(hash.sha1_crypt.encrypt(cleartext, salt = arg('salt'), rounds = intarg('rounds')))
                    elif ('sun_md5_crypt' in args['algorithm']):
                        return sendJson(hash.sun_md5_crypt.encrypt(cleartext, salt = arg('salt'), rounds = intarg('rounds')))
                    elif ('sha256_crypt' in args['algorithm']):
                        return sendJson(hash.sha256_crypt.encrypt(cleartext, salt = arg('salt'), rounds = intarg('rounds')))
                    elif ('sha512_crypt' in args['algorithm']):
                        return sendJson(hash.sha512_crypt.encrypt(cleartext, salt = arg('salt'), rounds = intarg('rounds')))
                    else:
                        return sendError('400 Bad Request', 'Unknown algorithm')
                except Exception as exc:
                    return sendError('400 Bad Request', exc)
            else:
                return sendJson(['md5_crypt', 'bcrypt', 'sha1_crypt', 'sun_md5_crypt', 'sha256_crypt', 'sha512_crypt'])
        elif ('hash' == path):
            if ('algorithm' in args):
                data = None
                if ('GET' == requestMethod):
                    data = arg('data')
                elif (requestMethod in ('POST', 'PUT')):
                    data = request('data')

                if (not data):
                    return sendError('400 Bad Request', 'No data specified')

                if ('sha256' == arg('algorithm')):
                    hasher = hashlib.sha256()
                    hasher.update(data.encode('utf-8'))
                    return sendJson(hasher.hexdigest())
                elif ('sha512' == arg('algorithm')):
                    hasher = hashlib.sha512()
                    hasher.update(data.encode('utf-8'))
                    return sendJson(hasher.hexdigest())
                else:
                    return sendError('400 Bad Request', 'Unknown algorithm')
            else:
                return sendJson(['sha256', 'sha512'])
        elif ('crc' == path):
            data = arg('data')
            if ('GET' == requestMethod):
                value = intarg('value')
            elif (requestMethod in ('POST', 'PUT')):
                value = requestInt('value')

            if (not data):
                return sendError('400 Bad Request', 'No data specified')

            crc = zlib.crc32(data.encode('utf-8'), value) if (value is not None) else zlib.crc32(data.encode('utf-8'))
            if ('application/json-patch+json' == acceptContentType):
                patch = [
                    { 'op': 'replace', 'path': '/public/output', 'value': crc },
                    { 'op': 'replace', 'path': '/readonly/outputTest', 'value': crc + 1 },
                    { 'op': 'replace', 'path': '/private/value', 'value': crc }
                ]
                return sendJson(patch, 'application/json-patch+json')
            else:
                api = {
                    'resources': {
                        'crc': {
                            'href-template': applicationURI + 'demo/crc/{?data}',
                            'href-vars': {
                                'data': 'param/hash/data'
                            },
                            'hints': {
                                'allow': ['PUT'],
                                'formats': {
                                    'application/json': {},
                                    'application/prs.w3ctag.crc.v1+json-api': {}
                                }
                            },
                            'functions': {
                                'update': {
                                    'arguments': ['data'],
                                    'format': 'application/json-patch+json',
                                    'method': 'PUT',
                                    'request-body': ['value']
                                }
                            }
                        }
                    },
                    'state': {
                        'public': {
                            'output': crc
                        },
                        'private': {
                            'value': crc
                        },
                        'readonly': {
                            "outputTest": crc + 1
                        },
                    }
                }
                return sendJson(api, 'application/prs.w3ctag.crc.v1+json-api')
        elif (not path):
            api = {
                'resources': {
                    'password': {
                        'href-template': applicationURI + 'demo/password/{?cleartext,algorithm,salt,rounds}',
                        'href-vars': {
                            'cleartext': 'param/pass/cleartext',
                            'algorithm': 'param/pass/algorithm',
                            'salt': 'param/pass/salt',
                            'rounds': 'param/pass/rounds'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.w3ctag.password.v1+json': {}
                            }
                        },
                        'functions': {
                            'getAlgorithms': {
                                'arguments': [],
                                'format': 'application/prs.w3ctag.password.v1+json',
                                'method': 'GET'
                            },
                            'hashPassword': {
                                'arguments': ['cleartext', 'algorithm', 'salt', 'rounds'],
                                'format': 'application/prs.w3ctag.password.v1+json',
                                'method': 'GET'
                            }
                        }
                    },
                    'hash': {
                        'href-template': applicationURI + 'demo/hash/{?algorithm}',
                        'href-vars': {
                            'data': 'param/hash/data',
                            'algorithm': 'param/hash/algorithm'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.w3ctag.password.v1+json': {}
                            }
                        },
                        'functions': {
                            'hash256': {
                                'arguments': ['data'],
                                'format': 'application/prs.w3ctag.hash.v1+json',
#                                'request-format': 'application/x-www-form-urlencoded',  # fails in chrome due to lack of FormData iterator
                                'method': 'POST',
                                'defaults': {
                                    'algorithm': 'sha256'
                                }
                            },
                            'hash512': {
                                'arguments': ['data'],
                                'format': 'application/prs.w3ctag.hash.v1+json',
                                'request-format': 'application/json',
                                'method': 'PUT',
                                'defaults': {
                                    'algorithm': 'sha512'
                                }
                            }
                        }
                    },
                    'crc': {
                        'href-template': applicationURI + 'demo/crc/{?data,value}',
                        'href-vars': {
                            'data': 'param/hash/data',
                            'value': 'param/hash/value'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.w3ctag.crc.v1+json-api': {}
                            }
                        },
                        'functions': {
                            'crc32': {
                                'arguments': ['data'],
                                'format': 'application/prs.w3ctag.crc.v1+json-api',
                                'method': 'GET'
                            }
                        }
                    }
                }
            }
            return sendJson(api, 'application/prs.w3ctag.crc.v1+json-api')
        else:
            return sendError('404 Not Found', 'Not found')
    else:
        return sendError('404 Not Found', 'Not found')
    return sendError('500 Internal Server Error', 'unhandled code')


def dump(env, start_response):
    start_response('200 OK', [('Content-Type','text/html')])
    yield b'<pre>'
    for key in env:
        yield key.encode('utf-8') + b':' + str(env[key]).encode('utf-8') + b'\n'


    yield b'\n'
    yield b'request_uri='+util.request_uri(env).encode('utf-8')+b'\n'
    yield b'application_uri='+util.application_uri(env).encode('utf-8')+b'\n'

    path = util.shift_path_info(env)
    while (path):
        yield b'path='+path.encode('utf-8')+b'\n'
        path = util.shift_path_info(env)

    args = parse.parse_qs(env['QUERY_STRING'])
    for key in args:
        yield key.encode('utf-8') + b': ' + b' '.join([value.encode('utf-8') for value in args[key]])

    return []


if __name__ == "__main__":      # called from the command line
    httpd = make_server('localhost', 8051, application)
    httpd.serve_forever()
