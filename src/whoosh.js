// whoosh.js
// Copyright (c) 2014 Damien Jones
// Based on whoosh.swf, Copyright (c) 2008 Damien Jones

;(function($, window, undefined){

	// default option set; this is merged with the passed-in
	// option set at player creation time
	var default_opts = {
		"base_name": "zoom{frame_number}.jpg",	// what the image files are named
		"first_frame": 1,						// number of the first frame (0, 1 are common)
		"last_frame": 10,						// last frame number (easier than counting)
		"digits": 2,							// how many digits make up the numbers
		"interval": 50,							// time in milliseconds between frames (20fps)
		"speed": 0.5,							// how fast the animation should zoom
		"rotate": 0.025,						// how fast the animation should spin
		"cushion": 4.0							// acceleration for starting/stopping
	};

	// player class; one of these is created and attached
	// to the containing DIV at player creation time
	function Whoosh(container, all_opts){
		console.log(container);
		console.log(all_opts);
		this.container = container;
		this.canvas = container.find('canvas');
		this.opts = all_opts;
		this.images = null;						// no images set up yet

		// playback requires some state data
		this.frame_position = 0.0;				// a float, not an integer
		this.frame_position_speed = 0.0;
		this.is_zooming_out = false;

		this.frame_rotation = 0.0;				// a float, not an integer
		this.frame_rotation_speed = 0.0;

		this.is_paused = false;
		this.interval_handle = null;

		// prep the images
		this.load_images();
	};

	Whoosh.prototype.load_images = function(){
		var that = this;
		var i = 0;
		this.images = [];
		for (i = this.opts.first_frame; i <= this.opts.last_frame; i++)
		{
			// for each frame, create an image object and set it up
			// to record when it's loaded
			var frame_number = ('0000'+i.toString()).substr(-this.opts.digits);
			var frame_name = this.opts.base_name.replace('{frame_number}', frame_number);
			console.log(frame_name);
			var image = new Image();
			image.src = frame_name;
			image.onload = function(){
				that.loaded_image(this);
			};
			this.images.push([ image, false ]);	// image isn't loaded YET
		}
	};

	Whoosh.prototype.loaded_image = function(image){
		var i = 0;
		for (i = 0; i < this.images.length; i++)
			if (this.images[i][0] == image)
			{
				console.log(i, this.images[i]);
				this.images[i][1] = true;
				break;
			}
	};

	Whoosh.prototype.start = function(){
		if (this.interval_handle == null)
		{
			var that = this;
			this.interval_handle = window.setInterval(function(){
				that.interval();
			}, this.opts.interval);
		}
	};

	Whoosh.prototype.stop = function(){
		if (this.interval_handle != null)
		{
			window.clearInterval(this.interval_handle);
			this.interval_handle = null;
		}
	};

	Whoosh.prototype.interval = function(){
		// the meat; what to do at each refresh interval

		// paused movies do absolutely nothing
		// (they should actually turn off the interval)
		if (this.is_paused)
			return;

		// update our zoom speed
		var position_speed = this.frame_position_speed;

		if (this.opts.cushion == 0)
		{
			// we're not cushioning speed changes; set them
			// to the final values right now
			position_speed = this.opts.speed;
		}
		else
		{
			// stub!
			position_speed = this.opts.speed;
		}

		// update our rotation speed
		var rotation_speed = this.frame_rotation_speed;

		if (this.opts.cushion == 0)
		{
			// we're not cushioning speed changes; set them
			// to the final values right now
			rotation_speed = this.opts.rotate;
		}
		else
		{
			// stub!
			rotation_speed = this.opts.rotate;
		}

		// with zoom and rotation speeds updated, update the
		// values
		this.frame_position += position_speed * 0.05;	// 1/20 is a kluge for now
		this.frame_rotation += rotation_speed * 18;

		// now figure out how to draw all these images
		var frame_top = Math.floor(this.frame_position);
		var frame_partial = this.frame_position - frame_top;
		var frame_count = 3;	// number of frames to render
		var base_scale = Math.pow(2.0, frame_partial);

		// draw the frames
		var context = this.canvas[0].getContext('2d');
		var cx = this.canvas.width() * 0.5;				// canvas center point
		var cy = this.canvas.height() * 0.5;

		console.log(this.frame_position, frame_top, cx, cy, base_scale);

		for (i = frame_top; i < frame_top+frame_count; i++)
		{
			if (i >= this.images.length)
				break;

			var image = this.images[i][0];
			var iw = image.width * base_scale;			// image dimensions, scaled appropriately
			var ih = image.height * base_scale;
			console.log('   ', i, iw, ih);
			context.drawImage(image, cx - iw*0.5, cy - ih*0.5, iw, ih);
			base_scale *= 0.5;
		}
	};


	// add to jQuery this function...
	$.fn.extend({
		"whoosh": function(opts) {
			// ...which iterates over all found objects and does...
			return this.each(function() {
				// ...the whoosh setup for this object

				// merge given options with defaults
				var all_opts = $.extend({}, default_opts, opts);

				// create the canvas and all the image references
				var container = $(this);
				var html_parts = [ '<canvas id="' + this.id + '_canvas" width=' + container.width() + ' height=' + container.height() + '></canvas>' ];
				// might add some other HTML bits soonish
				container.html(html_parts.join(''));

				// create the player data object
				var player = new Whoosh(container, all_opts);
				$(this).data('whoosh', player);
			});
		}
	});
})(jQuery, window);
