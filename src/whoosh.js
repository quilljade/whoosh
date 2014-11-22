// whoosh.js
// Copyright (c) 2014 Damien Jones
// Based on whoosh.swf, Copyright (c) 2008 Damien Jones

;(function($, window, undefined) {
	var default_opts = {
		"base_name": "zoom{frame_number}.jpg",
		"first_frame": 1,
		"last_frame": 10,
		"digits": 2
	};

	// add to jQuery this function...
	$.fn.extend({
		"whoosh": function(opts) {
			// ...which iterates over all found objects and does...
			return this.each(function() {
				// ...the whoosh setup for this object
				var all_opts = $.extend({}, default_opts, opts);
				var o = $(this);
				$(this).html('<canvas width=' + o.width() + ' height=' + o.height() + '></canvas>');
			});
		}
	});
})(jQuery, window);
