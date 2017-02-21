var Influx = require('influx');
var assert = require('assert');

// ************************* Test Analytics DB ***************************
var myDB = 'test1';
const client = new Influx.InfluxDB({
      // or single-host configuration
      host : 'ec2-54-210-219-155.compute-1.amazonaws.com',
      port: 8086,
      database : myDB,
      schema: [{
          measurement: orderPerItem,
          fields: {
            price: Influx.FieldType.FLOAT,
            qtyOrdered: Influx.FieldType.FLOAT,
            available: Influx.FieldType.FLOAT
          },
          tags: [
          'homeId','farmId','itemId', 'unit'
          ]
        }]
      });

// ************************* Production Analytics ***************************
var analyticsDB = 'analytics';
var orderPerItem = "orderPerItemSeries";
var orderTotal = "orderTotalSeries";
var newFarmItemSeries = "farmitemseries";
var homeOrderSeries = "homeorderseries";
var userEventSeries = "usereventseries";
var screenEeventSeries = "screeneventseries";

const clientAnalytics = new Influx.InfluxDB({
      // or single-host configuration
      host : 'ec2-54-210-219-155.compute-1.amazonaws.com',
      //host : 'localhost',
      port: 8086,
      database : analyticsDB,
      schema: [{
          measurement: newFarmItemSeries,
          fields: {
            price: Influx.FieldType.FLOAT,
            available: Influx.FieldType.FLOAT
          },
          tags: [
          'farmId','itemId', 'unit'
          ]
        },
        {
          measurement: userEventSeries,
          fields: {
            value: Influx.FieldType.FLOAT,
          },
          tags: [
          'userType', 'userName', 'userId', 'userEvent'
          ]
        },
        {
          measurement: screenEeventSeries,
          fields: {
            value: Influx.FieldType.FLOAT,
          },
          tags: [
          'screenName', 'userType', 'userName', 'userId'
          ]
        }
        ]
      });

function timeSeriesWriteScreenEvent(series, fieldList, tagList, timeinMS) {
  if (tagList === null) {
    return;
  }
  var screen = tagList.screen;
  var utype = tagList.userType;
  var uname = tagList.userName;
  var uid =   tagList.userId;


  clientAnalytics.writePoints([{
    measurement: series,
    tags: { screenName: screen, userType: utype, userName: uname, userId: uid },
    fields: { value: 1},
    timestamp: timeinMS
  }]).then(() => {
      //console.info('Screen Event Write success');
    }).catch(err => {
      console.error("Screen Event Write error: ",err);
  });
}

function timeSeriesWriteUserEvent(series, fieldList, tagList, timeinMS) {
  if (tagList === null) {
    return;
  }
  var utype = tagList.userType;
  var uname = tagList.userName;
  var uid =   tagList.userId;
  var uevent = tagList.event;

  clientAnalytics.writePoints([{
    measurement: series,
    tags: { userType: utype, userName: uname, userId: uid, userEvent: uevent},
    fields: { value: 1},
    timestamp: timeinMS
  }]).then(() => {
      //console.info('User Event Write success');
    }).catch(err => {
      console.error("User Event Write error: ",err);
  });
}

function timeSeriesWriteHomeOrder(series, fieldList, tagList, timeinMS) {
  if (fieldList === null) {
    return;
  }
  
  var orderId = fieldList.orderId;
  // First get the order
  Parse.Promise.as().then(function() {

    var orderQuery = new Parse.Query('Order');
    // Find the item to purchase.
    orderQuery.equalTo("objectId", orderId);
    orderQuery.include("homeInventories");
    orderQuery.include("homeInventories.farmInv");

    /**
     * Find the results. We handle the error here so our
     * handlers don't conflict when the error propagates.
     * Notice we do this for all asynchronous calls since we
     * want to handle the error differently each time.
     */
    return orderQuery.first().then(null, function (error) {
        console.log("could not find the order", error);
        return Parse.Promise.error('DB query failed? - Order query failure for analytics.');
    });

  }).then(function(result) {
    // Make sure we found an item.
    if (!result) {
      return Parse.Promise.error('Order is no longer available for analytics.');
    }
    order = result;
    logOrderInventories(order);

    // And we're done
    /**
     * Any promise that throws an error will propagate to this handler.
     * We use it to return the error from our Cloud Function using the
     * message we individually crafted based on the failure above.
     */
  }, function(error) {
    console.log("Order Analytics event @error catchAll: ", error.toString());
  });
}

function timeSeriesWriteFarmItem(series, fieldList, tagList, timeinMS) {
  if (fieldList === null) {
    return;
  }
  if (tagList === null) {
    return;
  }
  var itemName = tagList.itemName;
  var farmName = tagList.farmName;
  var itemUnit = tagList.itemUnit;
  var itemPrice = fieldList.itemPrice;
  var itemTotAvail = fieldList.itemTotAvail;

  clientAnalytics.writePoints([{
    measurement: series,
    tags: { farmId: farmName, itemId: itemName, unit: itemUnit},
    fields: { price: itemPrice, available: itemTotAvail},
    timestamp: timeinMS
  }]).then(() => {
      //console.info('Farm Item Update Event Write success');
    }).catch(err => {
      console.error("Farm Item Update Event Write error: ",err);
  });
}

Parse.Cloud.define('trackingEventPost', function(request, response) {
  var type   = request.params.type;
  var series = request.params.series;
  var fieldList = request.params.fields;
  var tagList = request.params.tags;
  var timeinMS = request.params.eventTimeStamp;
  var metricLines = request.params.lines;

  //console.error("Analytics Tracking Event received. Type:  ", type.toString(), " series: ", series.toString());

  if (type.toString() === 'timeseries') {
    // Write the Farm Item Series point
    if (series.toString() === newFarmItemSeries) {
      timeSeriesWriteFarmItem(series, fieldList, tagList, timeinMS);
    }
    // Write the User Event Series point
    if (series.toString() === userEventSeries) {
      timeSeriesWriteUserEvent(series, fieldList, tagList, timeinMS);
    }
    // Write the Screen Event Series point
    if (series.toString() === screenEeventSeries) {
      timeSeriesWriteScreenEvent(series, fieldList, tagList, timeinMS);
    }
    // Write the Home Order Series point
    if (series.toString() === homeOrderSeries) {
      timeSeriesWriteHomeOrder(series, fieldList, tagList, timeinMS);
    }
  }

  //console.log("Success writing app event to analytics DB");
  response.success('Success writing app event to analytics DB');

});

function writeToTotalSeries(homeEmail, totalPrice, checkOutTime) {
/*
 client.writePoint(orderTotalseries, point, {homeId: homeEmail}, {db: myDB},
    function(err, resp) {
      if (err) {
        console.log("error writing order total to DB", err);
        response.error(err);
      } else {
        response.success('Success writing order total');
      }
  });
  */

  clientAnalytics.writePoints([{
    measurement: orderTotal,
    tags: { homeId: homeEmail},
    fields: {price: totalPrice},
    timestamp: checkOutTime
  }]);
}

function writeToItemSeries(homeEmail, farmName, itemName, itemQty, itemUnit, itemPrice, itemTotAvail, checkOutTime) {
  clientAnalytics.writePoints([{
    measurement: orderPerItem,
    tags: { homeId: homeEmail, farmId: farmName, itemId: itemName, unit: itemUnit},
    fields: { qtyOrdered: itemQty, price: itemPrice, available: itemTotAvail},
    timestamp: checkOutTime
  }]);
}

function logOrderInventories(order) {

  var hInvList = order.get("homeInventories");
  var homeEmail = order.get("homeEmail");
  var cOutTime = order.get("checkoutTime");
  timeinMS = new Date(cOutTime);

  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    var fInv = hInv.get("farmInv");

    var farmName = fInv.get("farmName");
    var itemName = fInv.get("name");
    var itemQty = hInv.get("homeCount");
    var itemPrice = fInv.get("rate");
    var itemUnit = fInv.get("unit");
    var itemTotAvail = fInv.get("totalAvailable");

    writeToItemSeries(homeEmail, farmName, itemName, itemQty, itemUnit, itemPrice, itemTotAvail, timeinMS);
  }

  var total = order.get("checkoutPrice");
  writeToTotalSeries(homeEmail, total, timeinMS);
}

var farmItemSeries = "itemseries";
Parse.Cloud.define('farmItempost', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.

 // var itemDescp = request.params.itemDescp;
 // var itemCategory = request.params.itemCategory;
 // var itemTotal = request.params.itemTotal;
 // var farmId = request.params.farmId;
 // var itemUnits = request.params.itemUnits;

  var itemName = request.params.itemName;
  var itemPrice = request.params.itemPrice;
  var farmName = request.params.farmName;
  var point = {value: itemPrice, time : new Date()};

  /*
   * Not using promises 
   * writePoint is not a promise
   *     - could write code to wrap it in a promise but too much complexity
   */
 client.writePoint(farmItemSeries, point, {item: itemName, price: itemPrice, farm: farmName}, {db: myDB},
    function(err, resp) {
      if (err) {
        console.log("error writing inevntory value to DB", err);
        response.error(err);
      } else {
        response.success('Success writing inventory value');
      }
  });
});

/**
 * Query the time series entries from the InfluxDB.
 *
 * Returns a set of data points in the last 1 hour
 */
Parse.Cloud.define('queryFarmItem', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
var itemname = request.params.itemName;
var farmname = request.params.farmName;

//var query = "SELECT * FROM " + farmItemSeries + " WHERE time > now() - 24h";
var query = "SELECT value FROM " + farmItemSeries + " WHERE item='"+ itemname + "' and farm='" + farmname + "'";

  client.query(query, 
    function(err, resp) {
      if (err) {
        console.log("error quering farm item in DB", err);
        response.error(err);
      } else {
        assert(resp instanceof Array);
        //console.log("response is", JSON.parse(resp));
        response.success(resp);
      }
  });
});