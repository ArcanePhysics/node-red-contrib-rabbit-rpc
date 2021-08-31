# rabbit-rpc - rabbit nodes for node-red
mqpt nodes to send and receive messages from rabbit with rpc functionality

## Table of Contents
* [General Info](#general-info)
* [Installation](#installation)
* [Use](#use)

## General Info
This is a simple http payload validator function.
Function takes in request payload and request map (see below) and outputs an array of validation results for each field present in the map.

## Installation

To install package run in terminal:
Through node-red interface or npm
```
$ <path/to/node-red>$ npm install node-red-contrib-rabbit-rpc
```

## Use
To use the function in your app.js file
Module provides 2 nodes for connecting to rabbit

rabbit-rpc-req - subscribes to a queue  and sends messages to rabbit
if msg.replyTo property is not set will wait for 30 seconds for a reply
if msg.replyTo is set, will simply send a message to msg.replyTo queue and not wait for reply

rabbit-rpc-server - subscribes to a queue and and reads messages from it

