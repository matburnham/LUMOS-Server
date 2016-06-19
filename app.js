var app = require('express')();
var express = require('express');
var path = require('path');
var server = require('http').Server(app);
var io = require('socket.io')(server);
var fs = require('fs');
var bodyParser = require('body-parser');
var Artnet = require('artnet');

var msgpack = require("msgpack-lite");

var dgram = require('dgram');
var udpBeat = dgram.createSocket('udp4');
var udpSetColourLong = dgram.createSocket('udp4');
var udpSetColourShort = dgram.createSocket('udp4');


var UDP_BEAT_PORT = 33333;
var UDP_BEAT_HOST = '0.0.0.0';
var UDP_COLOUR_LONG_PORT = 3001;
var UDP_COLOUR_LONG_HOST = '0.0.0.0';
var UDP_COLOUR_SHORT_PORT = 3002;
var UDP_COLOUR_SHORT_HOST = '0.0.0.0';

server.listen(3000);

var nodes = safelyParseJSON(fs.readFileSync('nodes.json', 'utf8'));
var nodeIDs = safelyParseJSON(fs.readFileSync('nodeIDs.json', 'utf8'));
var timeouts = [];
var artnetInstances = [];

(function(){
  for (var property in nodes) {
    if(nodes.hasOwnProperty(property)){
      artnetInstances[nodes[property].nodeID] = Artnet({host:"0.0.0.0",refresh:1000,minPackageLength:3,maxPackageLength:10});
      artnetInstances[nodes[property].nodeID].set([0,0,0]);
    }
  }
})();

app.use('/', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

app.route('/nodes')
  .get(function(req, res, next){
    res.type('application/json');

    var jsonNodes = {};
    jsonNodes.nodes = [];
    for (var property in nodes) {
      if(nodes.hasOwnProperty(property)){
        jsonNodes.nodes.push({"nodeID" : nodes[property].nodeID, "battery" : nodes[property].battery, "online" : nodes[property].online, "enabled" : nodes[property].enabled, "colour" : nodes[property].colour});
      }
    }

    res.send(JSON.stringify(jsonNodes, null, 2));
  })
  .put(function(req, res, next){
    // Itterate over array of nodes and set colours in main array
    var responce = {"nodes" : []};

    if(req.body.nodes !== undefined){
      for(var i = 0; i < req.body.nodes.length; i++){
        // Do we have an id?
        if(req.body.nodes[i].nodeID !== undefined){
          // Is it a number?
          if(typeof req.body.nodes[i].nodeID == "number"){
            // Do we have a colour?
            if(req.body.nodes[i].colour !== undefined){
              // Is it a valid colour?
              if(req.body.nodes[i].colour.match(/^(?:[0-9a-fA-F]{3}){1,2}$/)){
                // We got totally valid data, now check we have that node
                if(nodes[req.body.nodes[i].nodeID] !== undefined){
                  // It exists! Update the colour
                  nodes[req.body.nodes[i].nodeID].colour = req.body.nodes[i].colour;
                  responce.nodes.push({"nodeID":req.body.nodes[i].nodeID,"result":"success"});
                  if(nodes[req.body.nodes[i].nodeID].enabled === true){
                    artnetInstances[req.body.nodes[i].nodeID].set([parseInt(req.body.nodes[i].colour[0] + req.body.nodes[i].colour[1], 16),parseInt(req.body.nodes[i].colour[2] + req.body.nodes[i].colour[3], 16),parseInt(req.body.nodes[i].colour[4] + req.body.nodes[i].colour[5], 16)]);
                  }
                }
                else{
                  responce.nodes.push({"nodeID":req.body.nodes[i].nodeID,"result":"nodeID not found"});
                }
              }
              else{
                responce.nodes.push({"nodeID":req.body.nodes[i].nodeID,"result":"invalid colour"});
              }
            }
            else{
              responce.nodes.push({"nodeID":req.body.nodes[i].nodeID,"result":"missing colour"});
            }
          }
          else{
            responce.nodes.push({"nodeID":req.body.nodes[i].nodeID,"result":"invalid nodeID"});
          }
        }
        else{
          responce.nodes.push({"nodeID":"?","result":"missing nodeID"});
        }
      }
    }
    res.send(responce);
  });

io.on('connection', function(socket){
  // console.log('a user connected');
  socket.on('disconnect', function(){
    // console.log('user disconnected');
  });

  socket.on('syncRequest', function(msg){
    // Grab all entries and send them
    // console.log('syncRequest received');
    socket.emit('syncResponce', nodes);
  });
});


// UDP functions
udpBeat.on('listening', function () {
    var address = udpBeat.address();
    // console.log('UDP Beat Server listening on ' + address.address + ":" + address.port);
});

udpSetColourLong.on('listening', function () {
    var address = udpSetColourLong.address();
    // console.log('UDP Colour Set Long Server listening on ' + address.address + ":" + address.port);
});

udpSetColourShort.on('listening', function () {
    var address = udpSetColourShort.address();
    // console.log('UDP Colour Set Short Server listening on ' + address.address + ":" + address.port);
});

udpBeat.on('message', function (message, remote) {
  // console.log('got beat: ' + message);

  var messageJSON = safelyParseJSON(message.toString());

  if(messageJSON !== undefined){
    if ((messageJSON.mac !== undefined) && (messageJSON.ip !== undefined) && (messageJSON.max_voltage !== undefined) && (messageJSON.min_voltage !== undefined) && (messageJSON.current_voltage !== undefined) && (messageJSON.lowest_voltage !== undefined) && (messageJSON.name !== undefined) && (messageJSON.output_enabled !== undefined)){

      // Get node id
      var nodeID = nodeIDs[messageJSON.name];

      // Add voltage percent to nodes
      nodes[nodeID].battery = Math.round((messageJSON.current_voltage - messageJSON.min_voltage) / ((messageJSON.max_voltage - messageJSON.min_voltage) / 100));
      if(nodes[nodeID].battery < 0){
        nodes[nodeID].battery = 0;
      }
      else if(nodes[nodeID].battery > 100){
        nodes[nodeID].battery = 100;
      }

      // Add code to emit io message
      messageJSON.nodeID = nodes[nodeID].nodeID;
      messageJSON.colour = nodes[nodeID].colour;
      messageJSON.enabled = nodes[nodeID].enabled;
      nodes[nodeID].online = true;
      messageJSON.online = nodes[nodeID].online;

      // Save data to array for initial loading of page
      nodes[nodeID].ip = messageJSON.ip;
      nodes[nodeID].current_voltage = messageJSON.current_voltage;
      nodes[nodeID].lowest_voltage = messageJSON.lowest_voltage;
      nodes[nodeID].mac = messageJSON.mac;
      nodes[nodeID].sw_version = messageJSON.sw_version;
      nodes[nodeID].hw_version = messageJSON.hw_version;

      if(nodes[nodeID].current_voltage_data.push(messageJSON.current_voltage) > 6500){
        nodes[nodeID].current_voltage_data.shift();
      }
      if(nodes[nodeID].lowest_voltage_data.push(messageJSON.lowest_voltage) > 6500){
        nodes[nodeID].lowest_voltage_data.shift();
      }

      // Set ip for artnet
      artnetInstances[nodeID].setHost(messageJSON.ip);

      // Start timer to make offline
      if(timeouts[nodeID] !== undefined){
        clearTimeout(timeouts[nodeID]);
      }
      timeouts[nodeID] = setTimeout(function() { setOffline(nodeID); }, 25000);

      io.emit('beat', messageJSON);
    }
	}
});

udpSetColourLong.on('message', function (message, remote) {
  //console.log(`got colour long:${message}`);

  var messageJSON = safelyParseJSON(message.toString());

  if(messageJSON.nodes !== undefined){
    for(var i = 0; i < messageJSON.nodes.length; i++){
      // Do we have an id?
      if(messageJSON.nodes[i].nodeID !== undefined){
        // Is it a number?
        if(typeof messageJSON.nodes[i].nodeID == "number"){
          // Do we have a colour?
          if(messageJSON.nodes[i].colour !== undefined){
            // Is it a valid colour?
            if(messageJSON.nodes[i].colour.match(/^(?:[0-9a-fA-F]{3}){1,2}$/)){
              // We got totally valid data, now check we have that node
              if(nodes[messageJSON.nodes[i].nodeID] !== undefined){
                // It exists! Update the colour
                nodes[messageJSON.nodes[i].nodeID].colour = messageJSON.nodes[i].colour;
                if(nodes[messageJSON.nodes[i].nodeID].enabled === true){
                  artnetInstances[messageJSON.nodes[i].nodeID].set([parseInt(messageJSON.nodes[i].colour[0] + messageJSON.nodes[i].colour[1], 16),parseInt(messageJSON.nodes[i].colour[2] + messageJSON.nodes[i].colour[3], 16),parseInt(messageJSON.nodes[i].colour[4] + messageJSON.nodes[i].colour[5], 16)]);
                }
              }
            }
          }
        }
      }
    }
  }
});

udpSetColourShort.on('message', function (message, remote) {
  //console.log(`got colour short`);

  var messageJSON = msgpack.decode(message);

  if(messageJSON.ns !== undefined){
    for(var i = 0; i < messageJSON.ns.length; i++){
      // Do we have an id?
      if(messageJSON.ns[i].n !== undefined){
        // Is it a number?
        if(typeof messageJSON.ns[i].n == "number"){
          // Do we have a colour?
          if(messageJSON.ns[i].c !== undefined){
            // Is it a valid colour?
            if(messageJSON.ns[i].c.match(/^(?:[0-9a-fA-F]{3}){1,2}$/)){
              // We got totally valid data, now check we have that node
              if(nodes[messageJSON.ns[i].n] !== undefined){
                // It exists! Update the colour
                nodes[messageJSON.ns[i].n].colour = messageJSON.ns[i].c;
                if(nodes[messageJSON.ns[i].n].enabled === true){
                  artnetInstances[messageJSON.ns[i].n].set([parseInt(messageJSON.ns[i].c[0] + messageJSON.ns[i].c[1], 16),parseInt(messageJSON.ns[i].c[2] + messageJSON.ns[i].c[3], 16),parseInt(messageJSON.ns[i].c[4] + messageJSON.ns[i].c[5], 16)]);
                }
              }
            }
          }
        }
      }
    }
  }
});

function setOffline(nodeID) {
  // console.info("offline");
  nodes[nodeID].online = false;
  io.emit('online-status', {"nodeID":nodeID,"online":nodes[nodeID].online});
}

(function() {
  var timeout = setInterval(function(){
    var output = {nodes:[]};
    for(var i = 0; i < Object.keys(nodes).length; i++){
      output.nodes.push({"nodeID":nodes[i+1].nodeID,"colour":nodes[i+1].colour});
    }
    io.emit('colours', output);
  }, 1000);
})();

udpBeat.bind(UDP_BEAT_PORT, UDP_BEAT_HOST);
udpSetColourLong.bind(UDP_COLOUR_LONG_PORT, UDP_COLOUR_LONG_HOST);
udpSetColourShort.bind(UDP_COLOUR_SHORT_PORT, UDP_COLOUR_SHORT_HOST);

// Helper functions
function safelyParseJSON (json) {
  // This function cannot be optimised, it's best to
  // keep it small!

  // preserve newlines, etc - use valid JSON

  json = json.replace(/\0/g, '');

  var parsed;

  try {
    parsed = JSON.parse(json);
  } catch (e) {
    // Oh well, but whatever...
    // console.log(e);
  }

  return parsed; // ould be undefined!
}