/**
 * From here...
 * New code added for inventory processing
 */
// Initialize the Stripe and Mailgun Cloud Modules
var Stripe = require('stripe')("sk_test_3n3xj9zbj6hOkEhngx7uITeH");
var Mailgun = require('mailgun-js')({apiKey: "key-afab485a6a9bf921692f83c3c1d03b56",
                                     domain: "sandboxd6cc36b660184159bc67c3f403466981.mailgun.org"});

var FORAGE_EMAIL = 'reachforagers@gmail.com';
var ORCHVIEW_EMAIL = 'reachorchardview@gmail.com';
var FORAGE_DUMMY_ID = "FORAGE_DUMMY_ID";
var SUCCESS_STR = 'Success';
var STRIPE_ERR_MOD = "STRIPE_ERR: ";

var FarmOrder = Parse.Object.extend("FarmOrder");

// Wrap as the Parse class function??? 
function createFarmOrder(farmId, order, ordList) {
  var fOrder = new FarmOrder();
  fOrder.set('farmId', farmId);
  fOrder.set('orderId', order.get('objectId'));
  fOrder.set('order', order); // a back pointer!
  fOrder.set('homeInventories', ordList);
  return fOrder;
}

// Create Farm suborders from Order
function parseAndSetupFarmOrders(order) {
  var fOrderArr = new Array();
  var ordList = new Array();
  var farmId = "";
  var fOrder;

  var hInvList = order.get('homeInventories');

  // Setup the first Id
  farmId = hInvList[0].get('farmId');
    
  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    //var fInv = hInv.get("farmInv");

    var hInvFarmId = hInv.get('farmId');
    if (hInvFarmId !== farmId) {
        // Pack and save the previous order list!
        fOrder = createFarmOrder(farmId, order, ordList);
        fOrderArr.push(fOrder);

        /* Setup for the next Farm! */
        farmId = hInvFarmId;
        ordList = new Array();
    }
    ordList.push(hInv);
  }

  if (ordList.length > 0) {
    // Save the last batch!
    fOrder = createFarmOrder(farmId, order, ordList);
    fOrderArr.push(fOrder);
  }

  return fOrderArr;
}


function stringifyHomeInventory(order, price) {
  var orderStringified = "";

  var hInvList = order.get("homeInventories");
    
  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    //var fInv = hInv.get("farmInv");

     orderStringified = orderStringified +
      hInv.get("name") +
      " * " +
      hInv.get("homeCount").toString() +
      " @ $" +
      hInv.get("rate").toString() +
      "/" +
      hInv.get("unit") +
      "\n\n";
  }
  orderStringified = orderStringified + "\n" + "Total Price: $" + price.toString() + "\n";

  return orderStringified;
}

function getHomeInventoryPrice(order) {
  var price = 0;
  var hInvList = order.get("homeInventories");

  for (var i = 0 ; i < hInvList.length; i++) {
    var hInv = hInvList[i];
    //var fInv = hInv.get("farmInv");

    price = price + hInv.get("rate") * hInv.get("homeCount");
  }
  
  return price;
}

/*
 * Example of parse promise array!
 *
function fetchCompleteOrder(order) {
  var promise_array = [];
  var orderPerFarms = order.get("orderFarms");

  for (var i = 0 ; i < orderPerFarms.length; i++) {
    var hInvList = orderPerFarms[i].get("homeInventories");

    for (var j = 0 ; j < hInvList.length; j++) {
      var hInv = hInvList[j];
      var fInv = hInv.get("farmInv");
      promise_array.push(fInv.fetch());
    }
  }
  
  return Parse.Promise.when(promise_array);
}
*/

/**
 * Purchase an item from the Parse Store using the Stripe
 * Cloud Module.
 *
 *  Expected input (in request.params):
 *   orderId      : String, to retrieve the order details
 *   newCard      : Boolean, new card => cardToken
 *      - cardToken      : String, the credit card token returned to the client by Stripe
 *
 * Also, please note that on success, "Success" will be returned.
 */
Parse.Cloud.define('purchaseInventory', function(request, response) {
  /**
   * Ensure only Cloud Code can get access by using the master key.
   * Parse.Cloud.useMasterKey();
   * XXX - this has been changed to useMasterKey: true as an option to each Parse.Query!
   */

  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.
  var order, orderString; 
  var price = 0;
  var cardToken = FORAGE_DUMMY_ID;
  var custEmail = FORAGE_EMAIL;

  var orderId = request.params.orderId;
  var newCard = request.params.newCard;
  var customerId = request.params.customerId;
  var cardId = FORAGE_DUMMY_ID;

  if (newCard) {
    cardToken = request.params.cardToken;
    // For new card the card ID will be generated and sent back to the app!
  } else {
    cardId = request.params.cardId;
  }

  // We start in the context of a promise to keep all the
  // asynchronous code consistent. This is not required.
  Parse.Promise.as().then(function() {

    var orderQuery = new Parse.Query('Order');
    // Find the item to purchase.
    orderQuery.equalTo("objectId", orderId);
    orderQuery.include("homeInventories");
    orderQuery.include("homeInventories.farmInv");

    /**
     * Find the resuts. We handle the error here so our
     * handlers don't conflict when the error propagates.
     * Notice we do this for all asynchronous calls since we
     * want to handle the error differently each time.
     */
    order = orderQuery.find().then(null, function(error) {
      console.log("could not find the order rec", error);
    });

    return orderQuery.first().then(null, function (error) {
        console.log("could not find the order", error);
        return Parse.Promise.error('DB query failed? - Order query failure.');
    });

  }).then(function(result) {
    // Make sure we found an item.
    if (!result) {
      return Parse.Promise.error('Sorry, the order is no longer available.');
    }
    order = result;

    /**
     *
     *  Recompute the price!
     *     - we cannot gaurantee the save could have happened in time. :( Safer to recompute!
     */
    price = getHomeInventoryPrice(order);
    if (price <= 0) {
      // Error check!
      return Parse.Promise.error('Empty Cart. Your credit card was not charged.');
    }
    orderString = stringifyHomeInventory(order, price);

    custEmail = order.get("homeEmail");

    if (newCard) {
      return Stripe.customers.createSource(customerId,
        { source: cardToken}
      ).then(function(card) {
        // Save the card ID as the source card info
        cardId = card.id;

        return Stripe.charges.create({
          amount: price * 100, // express dollars in cents
          currency: "usd",
          customer: customerId,
          source: cardId,
          metadata: {'order_id': orderId} // Save orderId, to correlate all orders for a user
          }).then(null, function(error) {
            console.log('Charging with stripe failed. Error: ' + error);
            // Check the Stripe error codes and return meaningful errors!!!
            return Parse.Promise.error('Charge create failed. Your credit card was not charged.');
          });
        });
    } else {
      // Charge the customer!
      return Stripe.charges.create({
          amount: price * 100, // express dollars in cents
          currency: "usd",
          customer: customerId, // Previously stored, then retrieved
          source: cardId, // Set source so we are not just using default card!
          metadata: {'order_id': orderId} // Save orderId, to correlate all orders for a user
        }).then(null, function(error) {
          console.log('Charging with stripe failed. Error: ' + error);
          return Parse.Promise.error('Charge create failed. Your credit card was not charged.');
        });
    }

  }).then(function(purchase) {

    // Credit card charged! Now we save the ID of the purchase on our
    // order and mark it as 'charged'.
    order.set('customerId', customerId);
    order.set('stripeCardId', cardId);
    order.set('stripePaymentId', purchase.id);
    order.set('charged', true);

    // Save updated order
    return order.save().then(null, function(error) {
      /**
       * From here are the worst places to fail since the card was charged but the order's
       * 'charged' field was not set. Here we need the user to contact us and give us
       * details of their credit card (last 4 digits) and we can then find the payment
       * on Stripe's dashboard to confirm which order to rectify.
       */
      console.log("order save screwup \n");

      return Parse.Promise.error('A critical error has occurred with your order #' + orderId +
                                 ' . Please contact ' + FORAGE_EMAIL + '.');
    });
  }).then(function(savedOrder) {
    // Store the global order variable as the saved value for the email function next!
    order = savedOrder;

    // Email sent to user - create farm order objects before responding to user!
    var ordList = parseAndSetupFarmOrders(order)
    return Parse.Object.saveAll(ordList).then(null, function(error) {
      console.log("farm order sorting failure", error);

      return Parse.Promise.error('Your purchase was successful, but we are not able to ' +
                                 'fulfill your order. Please contact us at ' + FORAGE_EMAIL + '.' +
                                 ' We will fix this ASAP!');
    });

  }).then(function(farmOrder) {
    // Credit card charged and order item updated properly!
    // We're done, so let's send an email to the user.

    // Generate the email body string.
    var body = "We've received and processed your order" + orderId + " for the following items: \n\n" +
               orderString + "\n";

    body += "Shipping Address: \n" +
            order.get("homeName") + "\n" +
            order.get("homeAddress") + "\n" +
            "\nWe will deliver your order by 6 pm today. " +
            "Thank you for shopping with Forage!\n\n" +
            "Packing with care,\n" +
            "Foragers";

    // Send the email.
    return Mailgun.messages().send({
      from: FORAGE_EMAIL,
      // to: home.get("email"),
      to: FORAGE_EMAIL, // custEmail - temp hack - the mailgun sandbox only allows approved emails
      // cc: FORAGE_EMAIL,
      bcc: ORCHVIEW_EMAIL,
      subject: 'Your farmer\'s market order' + orderId + ' is ready!',
      text: body
    }).then(null, function(error) {

      console.log("email send failure", error);

      return Parse.Promise.error('Your purchase was successful, but we were not able to ' +
                                 'send you an email. Please contact us at ' + FORAGE_EMAIL + '.');
    });

  }).then(function() {
    // And we're done - send the card Id back!
    response.success(cardId);

    /**
     * Any promise that throws an error will propagate to this handler.
     * We use it to return the error from our Cloud Function using the
     * message we individually crafted based on the failure above.
     */
  }, function(error) {

    console.log("@error catchAll: ", error.toString());

    response.error(error);
  });
});


/**
 * Send user code to the registered email.
 *
 *  Expected input (in request.params):
 *   email     : User's email
 *   code      : Code to be sent in the email
 *
 * Simple email send function - on success, "Success" will be returned.
 */
Parse.Cloud.define('verifyEmail', function(request, response) {
  // Top level variables used in the promise chain. Unlike callbacks,
  // each link in the chain of promise has a separate context.

  var userEmail = request.params.userEmail;
  var userCode = request.params.userCode;

  // Let's send an email to the user.
  
  // Generate the email body string.
  var body = "Hi,\n\n" +
             "The confirmation code for your Forage App is: " +
             userCode + "\n\n";

  body += "Thank you,\n" +
          "Foragers";

  // Send the email.
  Mailgun.messages().send({
    from: FORAGE_EMAIL,
    //to: home.get("email"),
    to: userEmail, // hack - the mailgun sandbox only allows approved emails
    cc: FORAGE_EMAIL,
    subject: 'Your Forage registration code!',
    text: body
  }).then(function() {
    response.success(SUCCESS_STR);
  }, function(error) {
    console.log("email send failure", error);
    response.error(error);
  });
});


/**
 * Create a stripe customer for this home user!
 *
 *  Expected input (in request.params):
 *   email     : User's email
 *   homeId    : Associate the homeId as meta data on the customer!
 *  
 * We create a customer without a credit card (source) here!
 */
Parse.Cloud.define('createStripeCustomer', function(request, response) {

  var userEmail = request.params.userEmail;
  var homeId = request.params.homeId;

  var custDesc = 'Customer for ' + homeId;

  // Create a new Stripe customer!
  Stripe.customers.create({
        description: custDesc, // Add the homeId as meta data
        email: userEmail // Save the user's email
      }).then(function(customer) {
        // Save the Id!
        customerId = customer.id;

        // Send the customer Id back!
        response.success(customerId);

      }, function(error) {
        console.log(STRIPE_ERR_MOD, "error in creating stripe customer", error);
        response.error(error);
      });
});

/**
 * Endpoints and routes for Stripe pre-built UI in iOS to access. 
 *
 *  Expected input (in request.params):
 *   customerId : the stripe customer Id, duh!
 *  
 */
/* Serve Stripe endpoint 1 */
Parse.Cloud.define('getStripeCustomer', function(request, response) {

  var customerId = request.params.customerId;

  Stripe.customers.retrieve(customerId, function(error, customer) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error in getting customer's payment types", error);
      response.error('Error retrieving customer.');
    } else {

      // Send the customer JSON back!
      response.success(customer);
    }
  });
});

/* Serve Stripe endpoint 2 */
Parse.Cloud.define('setStripeCustomerSource', function(request, response) {

  var customerId = request.params.customerId;
  var cardId = request.params.cardId;

  Stripe.customers.createSource(customerId, {
    source: cardId
  }, function(error, source) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error adding a payment type to a customer", error);
      response.error('Error attaching source.');
    } else {
      response.success(SUCCESS_STR);
    }
  });
});

/* Serve Stripe endpoint 3 */
Parse.Cloud.define('updateStripeCustomerDefaultSource', function(request, response) {
  var customerId = request.params.customerId;
  var cardToken = request.params.cardToken;

  Stripe.customers.update(customerId, {
    default_source: cardToken
  }, function(error, customer) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error in getting customer's payment types", error);
      response.error('Error setting default source.');
    } else {
      response.success(SUCCESS_STR);
    }
  });
});