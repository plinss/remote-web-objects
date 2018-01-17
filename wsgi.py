#!/usr/bin/env python3

import cgi
import hashlib
import io
import json
import multiprocessing.pool
import time
import zlib

from urllib import parse

from wsgiref import util
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer

from passlib import hash


def application(env, start_response):
    request_uri = util.request_uri(env)
    application_uri = util.application_uri(env)
    request_method = env.get('REQUEST_METHOD', 'GET').upper()
    request_content_type, request_content_args = cgi.parse_header(env.get('CONTENT_TYPE'))
    request_encoding = request_content_args.get('encoding', 'utf-8')
    accept_content_type = env.get('HTTP_ACCEPT')
    request_origin = env.get('HTTP_ORIGIN') or 'localhost'

    def send_json(obj, content_type='application/json'):
        start_response('200 OK', [('Content-Type', content_type), ('Access-Control-Allow-Origin', request_origin)])
        yield json.dumps(obj, indent='  ', sort_keys=True).encode('utf-8')

    def send_error(code, message):
        start_response(code, [('Content-Type', 'text/plain')])
        yield str(message).encode('utf-8')

    def send_file(file_path, content_type='text/html'):
        start_response('200 OK', [('Content-Type', content_type)])
        with open(file_path) as file:
            yield file.read().encode('utf-8')

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

    try:
        request_content_length = int(env.get('CONTENT_LENGTH', 0))
    except (ValueError):
        request_content_length = 0
    request_body = env['wsgi.input'].read(request_content_length).decode(request_encoding)

    if (request_content_type.endswith('/json') or request_content_type.endswith('+json')):
        request_data = json.loads(request_body)
    elif ('application/x-www-form-urlencoded' == request_content_type):
        request_data = parse.parse_qs(request_body)
    elif ('multipart/form-data' == request_content_type):
        if ('boundary' in request_content_args):
            request_content_args['boundary'] = request_content_args['boundary'].encode('ascii')
        request_data = cgi.parse_multipart(io.BytesIO(request_body.encode(request_encoding)), request_content_args)
    else:
        request_data = {}

    def request(key):
        value = request_data.get(key)
        if (not isinstance(value, str) and hasattr(value, '__getitem__')):
            value = value[0]
            if (isinstance(value, bytes)):
                value = value.decode(request_encoding)
        return value

    def request_int(key):
        value = request(key)
        if (value is not None):
            try:
                return int(value)
            except (ValueError):
                pass
        return None

#    print(request_content_type)
#    print(request_encoding)
#    print(repr(request_data))
#    print(repr(args))

    path = util.shift_path_info(env)
    if ('demo' == path):
        path = util.shift_path_info(env)
        if ('password' == path):
            if ('algorithm' in args):
                cleartext = arg('cleartext')
                if (not cleartext):
                    return send_error('400 Bad Request', 'No cleartext specified')

                try:
                    if ('md5_crypt' in args['algorithm']):
                        return send_json(hash.md5_crypt.encrypt(cleartext, salt=arg('salt')))
                    elif ('bcrypt' in args['algorithm']):
                        return send_json(hash.bcrypt.encrypt(cleartext, salt=arg('salt'), rounds=intarg('rounds'), ident='2b'))
                    elif ('sha1_crypt' in args['algorithm']):
                        return send_json(hash.sha1_crypt.encrypt(cleartext, salt=arg('salt'), rounds=intarg('rounds')))
                    elif ('sun_md5_crypt' in args['algorithm']):
                        return send_json(hash.sun_md5_crypt.encrypt(cleartext, salt=arg('salt'), rounds=intarg('rounds')))
                    elif ('sha256_crypt' in args['algorithm']):
                        return send_json(hash.sha256_crypt.encrypt(cleartext, salt=arg('salt'), rounds=intarg('rounds')))
                    elif ('sha512_crypt' in args['algorithm']):
                        return send_json(hash.sha512_crypt.encrypt(cleartext, salt=arg('salt'), rounds=intarg('rounds')))
                    else:
                        return send_error('400 Bad Request', 'Unknown algorithm')
                except Exception as exc:
                    return send_error('400 Bad Request', exc)
            else:
                return send_json(['md5_crypt', 'bcrypt', 'sha1_crypt', 'sun_md5_crypt', 'sha256_crypt', 'sha512_crypt'])
        elif ('hash' == path):
            if ('algorithm' in args):
                data = None
                if ('GET' == request_method):
                    data = arg('data')
                elif (request_method in ('POST', 'PUT')):
                    data = request('data')

                if (not data):
                    return send_error('400 Bad Request', 'No data specified')

                if ('sha256' == arg('algorithm')):
                    hasher = hashlib.sha256()
                    hasher.update(data.encode('utf-8'))
                    return send_json(hasher.hexdigest())
                elif ('sha512' == arg('algorithm')):
                    hasher = hashlib.sha512()
                    hasher.update(data.encode('utf-8'))
                    return send_json(hasher.hexdigest())
                else:
                    return send_error('400 Bad Request', 'Unknown algorithm')
            else:
                return send_json(['sha256', 'sha512'])
        elif ('crc' == path):
            data = arg('data')
            if ('GET' == request_method):
                value = intarg('value')
            elif (request_method in ('POST', 'PUT')):
                value = request_int('value')

            if (not data):
                return send_error('400 Bad Request', 'No data specified')

            crc = zlib.crc32(data.encode('utf-8'), value) if (value is not None) else zlib.crc32(data.encode('utf-8'))
            if ('application/json-patch+json' == accept_content_type):
                patch = [
                    {'op': 'replace', 'path': '/public/output', 'value': crc},
                    {'op': 'replace', 'path': '/readonly/readonlyOutput', 'value': crc},
                    {'op': 'replace', 'path': '/private/value', 'value': crc},
                    {'op': 'replace', 'path': '/return', 'value': crc},
                ]
                return send_json(patch, 'application/json-patch+json')
            else:
                api = {
                    'resources': {
                        'crc': {
                            'hrefTemplate': application_uri + 'demo/crc/{?data}',
                            'hrefVars': {
                                'data': 'param/hash/data'
                            },
                            'hints': {
                                'allow': ['PUT'],
                                'formats': {
                                    'application/json': {},
                                    'application/prs.remotewebobjectdemo.crc.v1+json-remote': {}
                                }
                            },
                            'functions': {
                                'update': {
                                    'arguments': ['data'],
                                    'format': 'application/json-patch+json',
                                    'method': 'PUT',
                                    'requestBody': ['value']
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
                            "readonlyOutput": crc
                        },
                    }
                }
                return send_json(api, 'application/prs.remotewebobjectdemo.crc.v1+json-remote')
        elif ('tick' == path):
            start_response('200 OK', [
                ('Content-Type', 'text/event-stream; charset=utf-8'),
                ('Access-Control-Allow-Origin', request_origin),
                ('Cache-Control', 'no-cache'),
            ])

            def do_tick():
                tick = 0
                while True:
                    time.sleep(1)
                    tick += 1
                    yield "event: tick\ndata: {tick}\n\n".format(tick=tick).encode('utf-8')
            return do_tick()
        elif ('clock' == path):
            start_response('200 OK', [
                ('Content-Type', 'text/event-stream; charset=utf-8'),
                ('Access-Control-Allow-Origin', request_origin),
                ('Cache-Control', 'no-cache'),
            ])

            def do_clock():
                while True:
                    time.sleep(1)
                    now = time.localtime()
                    if (0 == now.tm_sec):
                        event = 'minute'
                    else:
                        event = 'second'
                    data = {'hour': now.tm_hour, 'minute': now.tm_min, 'second': now.tm_sec}
                    yield "event: {event}\ndata: {data}\n\n".format(event=event, data=json.dumps(data)).encode('utf-8')
            return do_clock()
        elif (not path):
            api = {
                'resources': {
                    'password': {
                        'hrefTemplate': application_uri + 'demo/password/{?cleartext,algorithm,salt,rounds}',
                        'hrefVars': {
                            'cleartext': 'param/pass/cleartext',
                            'algorithm': 'param/pass/algorithm',
                            'salt': 'param/pass/salt',
                            'rounds': 'param/pass/rounds'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.remotewebobjectdemo.password.v1+json': {}
                            }
                        },
                        'functions': {
                            'getAlgorithms': {
                                'arguments': [],
                                'format': 'application/prs.remotewebobjectdemo.password.v1+json',
                                'method': 'GET'
                            },
                            'hashPassword': {
                                'arguments': ['cleartext', 'algorithm', 'salt', 'rounds'],
                                'format': 'application/prs.remotewebobjectdemo.password.v1+json',
                                'method': 'GET'
                            }
                        }
                    },
                    'hash': {
                        'hrefTemplate': application_uri + 'demo/hash/{?algorithm}',
                        'hrefVars': {
                            'data': 'param/hash/data',
                            'algorithm': 'param/hash/algorithm'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.remotewebobjectdemo.password.v1+json': {}
                            }
                        },
                        'functions': {
                            'hash256': {
                                'arguments': ['data'],
                                'format': 'application/prs.remotewebobjectdemo.hash.v1+json',
                                'requestFormat': 'application/x-www-form-urlencoded',
                                'method': 'POST',
                                'defaults': {
                                    'algorithm': 'sha256'
                                }
                            },
                            'hash512': {
                                'arguments': ['data'],
                                'format': 'application/prs.remotewebobjectdemo.hash.v1+json',
                                'requestFormat': 'multipart/form-data',
                                'method': 'PUT',
                                'defaults': {
                                    'algorithm': 'sha512'
                                }
                            }
                        }
                    },
                    'crc': {
                        'hrefTemplate': application_uri + 'demo/crc/{?data,value}',
                        'hrefVars': {
                            'data': 'param/hash/data',
                            'value': 'param/hash/value'
                        },
                        'hints': {
                            'allow': ['GET'],
                            'formats': {
                                'application/json': {},
                                'application/prs.remotewebobjectdemo.crc.v1+json-remote': {}
                            }
                        },
                        'functions': {
                            'crc32': {
                                'arguments': ['data'],
                                'format': 'application/prs.remotewebobjectdemo.crc.v1+json-remote',
                                'method': 'GET'
                            }
                        }
                    },
                    'tick': {
                        'href': application_uri + 'demo/tick',
                        'events': {
                            'tick': {}
                        }
                    },
                    'clock': {
                        'href': application_uri + 'demo/clock',
                        'events': {
                            'second': {},
                            'minute': {}
                        }
                    }
                }
            }
            return send_json(api, 'application/prs.remotewebobjectdemo.crc.v1+json-remote')
        else:
            return send_error('404 Not Found', 'Not found')
    elif ('' == path):
        return send_file('index.html')
    elif ('remotewebobject.js' == path):
        return send_file('remotewebobject.js', 'application/javascript')
    elif ('uritemplate.js' == path):
        return send_file('uritemplate.js', 'application/javascript')
    else:
        return send_error('404 Not Found', 'Not found')
    return send_error('500 Internal Server Error', 'unhandled code')


def dump(env, start_response):
    start_response('200 OK', [('Content-Type', 'text/html')])
    yield b'<pre>'
    for key in env:
        yield key.encode('utf-8') + b':' + str(env[key]).encode('utf-8') + b'\n'

    yield b'\n'
    yield b'request_uri=' + util.request_uri(env).encode('utf-8') + b'\n'
    yield b'application_uri=' + util.application_uri(env).encode('utf-8') + b'\n'

    path = util.shift_path_info(env)
    while (path):
        yield b'path=' + path.encode('utf-8') + b'\n'
        path = util.shift_path_info(env)

    args = parse.parse_qs(env['QUERY_STRING'])
    for key in args:
        yield key.encode('utf-8') + b': ' + b' '.join([value.encode('utf-8') for value in args[key]])

    return []


class ThreadPoolWSGIServer(WSGIServer):
    '''WSGI-compliant HTTP server.  Dispatches requests to a pool of threads.'''

    def __init__(self, thread_count=None, *args, **kwargs):
        '''If 'thread_count' == None, we'll use multiprocessing.cpu_count() threads.'''
        WSGIServer.__init__(self, *args, **kwargs)
        self.thread_count = thread_count
        self.pool = multiprocessing.pool.ThreadPool(self.thread_count)

    # Inspired by SocketServer.ThreadingMixIn.
    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
            self.shutdown_request(request)
        except:
            self.handle_error(request, client_address)
            self.shutdown_request(request)

    def process_request(self, request, client_address):
        self.pool.apply_async(self.process_request_thread, args=(request, client_address))


def make_server(host, port, app, thread_count=None, handler_class=WSGIRequestHandler):
    '''Create a new WSGI server listening on `host` and `port` for `app`'''
    httpd = ThreadPoolWSGIServer(thread_count, (host, port), handler_class)
    httpd.set_app(app)
    return httpd


if __name__ == "__main__":      # called from the command line
    httpd = make_server('localhost', 8051, application)
    httpd.serve_forever()
