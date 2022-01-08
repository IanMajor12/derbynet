$(function() {
  var profiles = all_profiles();
  for (var i = 0; i < profiles.length; ++i) {
    $("#profiles-list").append($("<li/>").text(profiles[i].name)
                               .toggleClass('undiscoverable', !profiles[i]?.prober)
                               .on('click', on_user_profile_selection));
  }
});

$(function() {
  try {
    // Once per second, broadcast a "timer is alive" message, so other tabs/windows won't
    // try to open a second instance or refresh this one.
    const bc = new BroadcastChannel('timer-alive');
    setInterval(function() {
      bc.postMessage({alive: true});
    }, 1000);

    // We can try to bring our window to the front, but it mostly doesn't work.
    const bc_focus = new BroadcastChannel('timer-focus');
    bc_focus.onmessage = function(ev) { window.focus(); }
  } catch (ex) {
    // BroadcastMessage isn't supported on all browsers
  }
});

// g_standalone gets set to true for standalone Electron version by inline
// script tag that follows the import of this file.
var g_standalone = false;

var g_role_finder = new RoleFinder();
var g_timer_proxy;

var g_ports = [];

$(function() {
  console.log('Starting initial action');
  if (false && !g_standalone) {  // TODO
    $("#port-button").addClass('hidden');
  }
  if (!('serial' in navigator)) {
    $("#no-serial-api").removeClass('hidden');
    show_modal("#no-serial-api-modal");
  } else if (!g_standalone) {
    setTimeout(async function() {
      console.log('timeout upon entry: calling getPorts()');

      g_ports = await navigator.serial.getPorts();
      update_ports_list();

      if (g_ports.length == 0) {
        // Display a modal, asking for a user gesture
        show_modal("#need-gesture-modal");
      } else {
        on_scan_click();
      }
    }, 1000);
  }
});

// This is the handler for the button in the #need-gesture-modal, offered when
// there's nothing we can do until the user makes some gesture.
function on_gesture_click() {
  close_modal("#need-gesture-modal");
  on_scan_click();
}

if (!g_standalone) {
  $(window).bind("beforeunload", function(event) {
    if (g_timer_proxy) {
      // Chrome ignores the prompt and substitutes its own generic message.  Gee, thanks.
      show_modal("#leaving_modal");
      setTimeout(function() { close_modal("#leaving_modal"); }, 10000);
      var prompt =
          "Leaving this page will disconnect the timer.  Are you sure you want to exit?";
      event.preventDefault();
      event.returnValue = prompt;
      return prompt;
    }
  });
}


function on_user_port_selection(event) {
  // "this" is the <li> clicked
  g_prober.user_chosen_port = $(this).index();
  $(this).siblings().removeClass('user-chosen');
  $(this).addClass('user-chosen');
}

function on_user_profile_selection(event) {
  g_prober.user_chosen_profile = $(this).index();
  $(this).siblings().removeClass('user-chosen');
  $(this).addClass('user-chosen');
}

async function request_new_port() {
  await new Promise((resolve, reject) => {
    $("#second_modal_background").fadeTo(200, 0.75, function() { resolve(1); });
  });
  try {
    var make_request = true;
    while (make_request) {
      make_request = g_standalone;
      // In browser, ask the user to pick one port.
      // In standalone, keep going until requestPort() throws (app will try to select every available port)
      await navigator.serial.requestPort().catch((e) => {
        // throw e;
        make_request = false;
      });
      g_ports = await navigator.serial.getPorts();
    }
  } finally {
    $("#second_modal_background").fadeOut(200);
  }
}

// "New Port" button
async function on_new_port_click() {
  // The "New Port" button forcibly requests a new port even if there are other
  // ports available, so the user gets the chance to choose
  await request_new_port();
  update_ports_list();
  g_prober.probe_until_found();
}


async function update_ports_list() {
  $("#ports-list li").slice(g_ports.length).remove();
  while ($("#ports-list li").length < g_ports.length) {
    // If ports have been added, the old ports may not be in the same positions,
    // so clear the CSS classes to avoid misleading UI.
    $("#ports-list li").removeClass('trouble probing chosen');
    $("#ports-list").append($("<li/>")
                            .on('click', on_user_port_selection));
  }
  for (var i = 0; i < g_ports.length; ++i) {
    var info = g_ports[i].getInfo();
    var label;
    if (info.hasOwnProperty('usbProductId')) {
      label = 'USB x' +
        info.usbVendorId.toString(16).padStart(4, '0') + '/x' +
        info.usbProductId.toString(16).padStart(4, '0');
    } else {
      label = 'Built-in port';
    }
    $("#ports-list li").eq(i).text(label);
  }
}

$(function() {
  var isOpen = false;
  TimerEvent.register({
    onEvent: function(event, args) {
      switch (event) {
      case 'GATE_OPEN':
        if (isOpen) return;
        isOpen = true;
        break;
      case 'GATE_CLOSED':
        if (!isOpen) return
        isOpen = false;
        beak;
      case 'LOST_CONNECTION':
        $("#probe-button").prop('disabled', false);
        setTimeout(async function() {
          g_timer_proxy = await g_prober.probe_until_found(); }, 0);
        break;
      }
      console.log('onEvent: ' + event + ' ' + (args || []).join(','));
    }
  });
});

// The "Scan" button
async function on_scan_click() {
  console.log('on_scan_click');
  g_prober.probe_until_found();
}


// Host side
async function on_connect_button(event) {
  event.preventDefault();
  var ui_url = $("#host-url").val() + '/action.php';
  if (!(ui_url.startsWith("http://") || ui_url.startsWith("https://"))) {
    ui_url = "http://" + ui_url;
  }
  if (ui_url != HostPoller.url) {
    HostPoller.url = ui_url;
    await g_role_finder.find_roles();
    if (g_role_finder.roles.length > 0) {
      $("#role-select").empty();
      for (var i = 0; i < g_role_finder.roles.length; ++i) {
        $("<option>").appendTo("#role-select").text(g_role_finder.roles[i].name);
      }
      mobile_select_refresh("#role-select");
    }
  }
  if (g_host_poller) {
    console.log('g_host_poller already exists.');
  } else if ($("#role-select").val()) {
    console.log('Trying to log in, with role:' +
                $("#role-select").val() + ', pwd:' + $("#host-password").val());
    $.ajax(HostPoller.url,
           {type: 'POST',
            data: {action: 'role.login',
                   name:  $("#role-select").val(),
                   password: $("#host-password").val()},
            success: function(data) {
              console.log(data);
              if (data.outcome.summary == 'success') {
                console.log('Login succeeded, creating host poller.');
                g_host_poller = new HostPoller();
                $("#host-status").prop('src', "img/status/ok.png");
                if (g_timer_proxy) {
                  g_host_poller.offer_remote_start(g_timer_proxy.has_remote_start());
                }
              }
            },
           });
  }
}
$(function() { $("#host-side-form").on('submit', on_connect_button); });
