# remote-web-objects

This repository contains a proposal for a declarative method of defining Javascript objects that expose a normal API surface where function implementations are performed via remote procedure calls over HTTP.

## The Problem ##

The web platform is gaining API surface at a rapid rate.
A number of these APIs are specialized to specific devices,
often only present for web browsers embedded in other products,
such as televisions, appliances, and automobiles.
Many of these devices would benefit from being available as network services,
for example, being able to control a television's tuner from a phone or tablet rather than the browser embedded within it.
However, creating web applications against network service APIs creates a burden for web developers, who would rather have a Javascript API,
but adding a Javascript API surface to every browser for every new device is an untenable burden for browser vendors.

## The Proposed Solution ##

This proposal creates a Remote Web Object Document, using JSON-syntax.
The Remote Web Object Document describes an HTTP + JSON API surface and provides bindings to Javascript functions, event handlers, and attributes.
By fetching and processing this document,
a web client can instantiate a Javascript object that implements the defined API surface,
automatically marshalling arguments and object state to asynchronous HTTP calls,
and automatically processing JSON responses as Javascript values returned via Promises.

In addition to being useful for device APIs,
this solution is also applicable for any specialized HTTP API that is intended to be accessed via Javascrpt code.

### The Approach ###

Rather than reinventing the wheel, this proposal builds on an existing proposal that describes HTTP API resources, [Home Documents for HTTP APIs](https://datatracker.ietf.org/doc/draft-nottingham-json-home/).

The API Home Document describes a series of HTTP API resources,
each with a URL or a [URI Template](https://tools.ietf.org/html/rfc6570),
an optional set of paramater descriptions,
and an optional set of resource hints,
specifying allowable HTTP methods, and request and response content types.

For example, an API that a provides password hashing service might look like:

    {
        'resources': {
            'password': {
                'hrefTemplate': '/api/password/{?cleartext,algorithm,salt,rounds}',
                'hrefVars': {
                    'cleartext': 'param/pass/cleartext',
                    'algorithm': 'param/pass/algorithm',
                    'salt': 'param/pass/salt',
                    'rounds': 'param/pass/rounds'
                },
                'hints': {
                    'allow': ['GET'],
                    'formats': {
                        'application/json': {}
                    }
                }
            }
        }
    }

The Remote Web Object Document is an API Home Document with function, event, and state descriptions optionally added to each API resource.

#### Defining Functions ####

As an example, two functions can be bound to the above API resource via the following:

    {
        'resources': {
            'password': {
                'hrefTemplate': '/api/password/{?cleartext,algorithm,salt,rounds}',
                'hrefVars': {
                    'cleartext': 'param/pass/cleartext',
                    'algorithm': 'param/pass/algorithm',
                    'salt': 'param/pass/salt',
                    'rounds': 'param/pass/rounds'
                },
                'hints': {
                    'allow': ['GET'],
                    'formats': {
                        'application/json': {}
                    }
                },
                'functions': {
                    'getAlgorithms': {
                        'arguments': []
                    },
                    'hashPassword': {
                        'arguments': ['cleartext', 'algorithm', 'salt', 'rounds']
                    }
                }
            }
        }
    }

A web client processing this Remote Web Object Document, would create an instance of a Javascript object with the following API:

    interface Password {
        Promise<sequence<USVString>> getAlgorithms();
        Promise<USVString> hashPassword(cleartext, algorithm, salt, rounds);
    }

Calling the <code>getAlgorithms()</code> function would be equivalent to a HTTP GET of '/api/password/', and parsing the JSON response.
Calling the <code>hashPassword()</code> function would resolve the URI Template by mapping the positional arguments to the template variables,
then proforming the HTTP GET, and parsing the JSON response.

In addition to mapping function arguments to URI Template variables,
arguments may be sent in the HTTP request body via PUT and POST methods encoded as either form data or JSON.

#### Defining Events ####

Events can also be bound to API resources, by declaring a list of event types.

For example, a "clock" API reource that fires a "second" event once per second and a "minute" event once per minute:

    {
        'resources': {
            'clock': {
                'href': '/api/clock',
                'events': ['second', 'minute']
            }
        }
    }

A web client processing this Remote Web Object Document would create an instance of a Javascript object that is an EventTarget,
and has "onsecond" and "onminute" event handler attributes:

    interface Clock implements EventTarget {
        attribute onsecond;
        attribute onminute;
    }

When the developer adds an event handler to the object,
either by assigning a funtion to either "on" handler, or calling <code>addEventListener()</code>,
the object will open an [EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface) connection to the '/api/clock/' URL and dispatch events as they are received by the server.

The data payload in the server-sent event would be automatically decoded (if in JSON encoding) and made available as attributes of the event object.

Removing all event handlers would close the EventSource connection.


#### Object State ####

In addition to defining functions and events,
a Remote Web Object Document can also declare state infomation that will be exposed as attributes of the Javascript object.

Provisions are made for defining public state, avalable as regular attributes,
readonly state, available as readonly attributes,
and private state, that is not exposed via Javascript.

Object state, including private state, is available to the HTTP API during URI template resolution and as request body data.

HTTP fetches that return JSON-Patch documents may modify the state of the object.

### Specification, Polyfill, and Demo ###

The beginnings of a more detailed specification describing the implementation of a Remote Web Object Document processor is provided in this repository.

In addition, a fully functional polyfill is available as an ES6 module in [remotewebobject.js](remotewebobject.js).

A demonstration web page of a Remote Web Object is available in [index.html](index.html) with an HTTP server implementaion of a demonstration API in [wsgi.py](wsgi.py).

A [live demo](https://remote-demo.w3ctag.org/) is also avalailable (note: requires [ES6 modules](https://caniuse.com/#feat=es6-module)).

