// whoosh.js
// Copyright (c) 2014-15 Damien Jones
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
		"speed": 0.5,							// how fast the animation should zoom, in keyframes per second
		"rotate": 0.025,						// how fast the animation should spin, in whole turns per second
		"cushion": 0.25							// how much to change speed, per second (zero disables cushion)
	};

	// player class; one of these is created and attached
	// to the containing DIV at player creation time
	function Whoosh(container, all_opts){
		console.log("creating player for", container);
		console.log("resolved options:", all_opts);
		this.container = container;
		this.canvas = container.find('canvas');
		this.context = this.canvas[0].getContext('2d');
		this.opts = all_opts;
		this.images = null;						// no images set up yet

		// playback state data
		this.is_zooming_out = false;			// essentially, a forwards-or-backwards flag
		this.is_paused = true;					// whether to ask for another animation frame
		this.was_paused = true;					// paused state prior to drag operation
		this.interval_handle = null;

		// zooming requires some state data; this
		// is computed per-frame but saved
		this.frame_time = null;
		this.frame_position = 0.0;				// a float, not an integer
		this.frame_position_speed = 0.0;
		this.frame_rotation = 0.0;				// a float, not an integer
		this.frame_rotation_speed = 0.0;

		// At each step we need to compute a new position; to
		// do that correctly we must know the time offset from
		// a reference point, and what position and speed that
		// reference point were at. Then we apply some math(s).
		// The reference point will be reset each time the
		// playback is started.
		this.reference_time = null;
		this.reference_position = 0.0;
		this.reference_position_speed = 0.0;
		this.reference_rotation = 0.0;
		this.reference_rotation_speed = 0.0;

		// we also compute and save the end position of the
		// movie as we might change this if we reverse the
		// movie while it's playing
		this.computed_position_end = 0.0;

		// when we set the reference position we will compute
		// the divisions between the segments, based on the
		// current cushion and the length of the movie
		this.time_position_acceleration_ends = 0.0;			// time offsets
		this.time_position_deceleration_begins = 0.0;
		this.time_position_deceleration_ends = 0.0;
		this.time_rotation_acceleration_ends = 0.0;

		this.computed_position_acceleration_ends = 0.0;		// actual computed values
		this.computed_position_deceleration_begins = 0.0;
		this.computed_rotation_acceleration_ends = 0.0;

		// callback methods
		this.rAF = this._rAF();

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
			var image = new Image();
			image.onload = function(){
				that.loaded_image(this);
			};
			image.src = frame_name;
			this.images.push([ image, false, null ]);	// image isn't loaded YET and doesn't have a memory context
		}

		// go ahead and set the end position of the movie
		// (stub; later refactor may move this)
		this.computed_position_end = this.images.length-1;	// last frame at 100% scale
	};

	Whoosh.prototype.loaded_image = function(image){
		var i = 0;
		for (i = 0; i < this.images.length; i++)
			if (this.images[i][0] == image)
			{
//				console.log("loaded:", i, this.images[i], this.images[i][0].width, 'x', this.images[i][0].height);
				this.images[i][1] = true;
				if (i == 0)
					this.render(0);				// first frame is loaded, render it
				break;
			}
	};

	// start (or unpause) a movie
	Whoosh.prototype.start = function(){
		if (this.is_paused)
		{
			console.log('starting player');
			this.is_paused = false;
			this.set_reference_point();
			window.requestAnimationFrame(this.rAF);
		}
	};

	// stop (or rather, pause) a movie
	// NOTE: if your intent is to stop and reset to the
	// beginning, you'll need to call reset() as well
	Whoosh.prototype.stop = function(){
		if (!this.is_paused)
		{
			console.log('stopping player');
			this.is_paused = true;
		}
	};

	// a simplified pause handler that stops/starts
	// based on the current state
	Whoosh.prototype.pause = function(){
		if (!this.is_paused)
			this.stop();
		else
			this.start();
	};

	// a simple reset handler
	Whoosh.prototype.reset = function(){
		// stop all motion
		this.stop();

		// reset the position
		this.frame_position = 0.0;				// a float, not an integer
		this.frame_position_speed = 0.0;
		this.frame_rotation = 0.0;				// a float, not an integer
		this.frame_rotation_speed = 0.0;

		// render the initial frame
		this.render(0);
	};

	// drag handler methods
	// NOTE: these are NOT the DOM event handlers; they are
	// internal methods you would call from event handlers to
	// do anything not part of the event-management code. See
	// the example HTML.

	Whoosh.prototype.dragstart = function(){
		console.log('drag starting');
		// save the current pause state because we need to
		// pause while dragging, and we want to restore the
		// pause state when we're done
		this.was_paused = this.is_paused;
		this.is_paused = true;
	};

	Whoosh.prototype.drag = function(pct){
		// it's up to the calling code to determine the
		// percentage position, but once that's done, this
		// code will render the image at that position
		//
		// NOTE: we compute based on the full length of
		// the movie, NOT based on the current endpoint,
		// since that might not be the movie's end if the
		// user asked to reverse the movie somewhere in
		// the middle
		//
		// NOTE: we also don't change the rotation while
		// seeking; that's too disorienting
		//
		var frame_position = (this.images.length-1) * pct * 0.01;
		this.frame_position = frame_position;
		this.render();
	};

	Whoosh.prototype.dragend = function(){
		console.log('drag ending');
		// restore the pause state and resume playing
		// NOTE: start() will update the pause state, we
		// only need to check whether to start or not
		if (!this.was_paused)
			this.start();
	};

	// a function suitable for use with requestAnimationFrame
	//
	// rAF asks the browser to invoke a function whenever
	// it's ready for an animation frame to be processed;
	// the browser automatically reduces the refresh rate
	// when the tab isn't in focus (and we can detect that
	// in other ways and pause the animation) but it also
	// automatically adjusts the frame rate to the browser's
	// capabilities.
	//
	// Unfortunately the function that rAF invokes has "this"
	// set to the window object, which isn't terribly helpful.
	// We construct a unique function that invokes interval().
	//
	Whoosh.prototype._rAF = function(){
		var that = this;
		return function(elapsed_time){
			that.interval(elapsed_time);
		};
	};

	// what to do at each refresh interval
	Whoosh.prototype.interval = function(elapsed_time){
		// paused movies do absolutely nothing
		// (if we were using setInterval we would need to
		// turn off the interval rather than using a do-nothing
		// callback, but we're using rAF shim now, so this is
		// actually how we turn off the animation)
		if (this.is_paused)
			return;

		// update position, rotation, and speeds
		this.frame_time = new Date();
		this.compute_position();

		// draw the whole frame
		this.render();

		// ask for another frame
		window.requestAnimationFrame(this.rAF);
	}

	// set up reference point and compute segment boundaries
	// for later position computation (reference point is a
	// copy of current position and speed)
	Whoosh.prototype.set_reference_point = function(){
		// anchored at this time
		this.reference_time = new Date();

		// clone of current position
		this.reference_position       = this.frame_position;
		this.reference_position_speed = this.frame_position_speed;
		this.reference_rotation       = this.frame_rotation;
		this.reference_rotation_speed = this.frame_rotation_speed;

		// There are three segments to the speed curve:
		//
		//  1. speed changes linearly from the reference
		//     point speed to the target speed (this.opts.speed)
		//  2. speed remains constant
		//  3. speed decreases linearly to zero at the end
		//     of the animation (such that position reaches
		//     the end point precisely when speed reaches
		//     zero)
		//
		// Position is thus a quadratic curve in segments
		// 1 and 2 and linear in segment 2.

		// compute the time offsets for the segment boundaries

		// end of first segment
		var t = (this.opts.speed - this.reference_position_speed) / this.opts.cushion;
		this.time_position_acceleration_ends = t;
		this.computed_position_acceleration_ends = this.reference_position + this.reference_position_speed*t + 0.5*this.opts.cushion*t*t;

		// beginning of third segment, relative to the end; we
		// can't compute the actual time until we know how far
		// the deceleration process will play over, and subtract
		// the acceleration and deceleration distances from the
		// total distance
		t = this.opts.speed / this.opts.cushion;
		this.time_position_deceleration_begins = -t;
		this.computed_position_deceleration_begins = this.computed_position_end - 0.5*this.opts.cushion*t*t;

		// now that we know where acceleration ends and
		// deceleration begins, we can compute the actual length
		// of time for the constant-speed section in the middle
		//
		// edge case: deceleration has to begin before acceleration
		// ends, because there's not enough room to reach full
		// speed; in this case, there's no constant-speed section
		//**** TODO
		t = (this.computed_position_deceleration_begins - this.computed_position_acceleration_ends) / this.opts.speed;
		this.time_position_deceleration_ends = this.time_position_acceleration_ends + t - this.time_position_deceleration_begins;
		this.time_position_deceleration_begins += this.time_position_deceleration_ends;

		// now, follow a similar process for rotation, except that
		// we don't decelerate
		//**** TODO

		console.log('reference point set', this);
	};

	// given a particular time offset, compute the current
	// position, rotation, and speeds
	Whoosh.prototype.compute_position = function(){
		var t = (this.frame_time - this.reference_time) * 0.001;	// elapsed time, in seconds

		if (t < this.time_position_acceleration_ends)
		{
			// segment 1: speed increases towards target speed
			this.frame_position = this.reference_position + this.reference_position_speed*t + 0.5*this.opts.cushion*t*t;
			this.frame_position_speed = this.reference_position_speed + this.opts.cushion*t;
		}
		else if (t < this.time_position_deceleration_begins)
		{
			// segment 2: speed is constant
			t -= this.time_position_acceleration_ends;
			this.frame_position = this.computed_position_acceleration_ends + this.opts.speed*t;
			this.frame_position_speed = this.opts.speed;
		}
		else
		{
			// segment 3: speed decreases towards zero
			t -= this.time_position_deceleration_ends;
			this.frame_position = this.computed_position_end - 0.5*this.opts.cushion*t*t;
			this.frame_position_speed = -this.opts.cushion*t;
		}
	};

	// the meat: how to render a single frame of the animation,
	// given a fractional frame position and rotation; this is
	// separate from the interval because there are two use
	// cases where we need to render arbitrary frames: (1) as
	// the first frame in the animation (immediately after the
	// first frame loads, even if the animation isn't started)
	// and (2) as the user drags a position slider
	Whoosh.prototype.render = function(frame_position){

		// We need to determine the base scale for the first
		// image. Subsequent images will always be half the
		// previous image size. Generally we want to render
		// one frame in the 50% to 100% range, one frame in
		// the 100% to 200% range, and as many additional
		// frames as required to fill the canvas. But we have
		// to draw the largest-scaled version first, so the
		// more detailed versions will overlay on top.
		//
		// We think of the frame_position as a floating-point
		// value representing which keyframe is the 100% to
		// 200% image. We do this because it's the most
		// straightforward way to represent position within
		// the whole animation. Note that this is not a TIME
		// but instead a position; since the playback speed
		// and acceleration factor are independent of the
		// keyframe data, we actually treat time as a value
		// from which we can determine position, rather than
		// the exact position.
		//
		// One complication is that there's no direct
		// relationship between the canvas dimensions and
		// the bitmap dimensions, nor is there any guarantee
		// that every keyframe image is the same size. To
		// make matters worse, we allow for images to be
		// arbitrarily rotated, so as we scan backwards to
		// find the largest image we need to render, we want
		// to determine whether the image actually overlaps
		// the whole canvas. The easiest method is to check
		// if the top corners of the canvas, rotated to their
		// positions within the copied image, are inside.
		//
		// It's possible in this search, especially at the
		// beginning, that we might not have any enlarged
		// images available. It would certainly be possible
		// to clamp the available frame positions to those
		// which can include full coverage, but as a design
		// choice we do not, because:
		//
		//  1. The number of larger keyframes we need will
		//     depend on the rotation angle of the frame.
		//
		//  2. The number of larger keyframes we need will
		//     depend on the canvas size (thus it may change
		//     if the canvas is a percentage of the page
		//     size, or the user switches to full-size mode).
		//
		// Either of these mean that the minimum frame position
		// value is not constant, and changing it will result
		// in some unpredictable and unpleasant jumps in the
		// current frame position. We instead impose this
		// consideration on the animation creator, recommending
		// that the first frame be rendered sufficiently large
		// to encompass whatever variations they permit during
		// playback.

		// determine base frame position
		if (frame_position == undefined)
			frame_position = this.frame_position;
		var frame_top = Math.floor(frame_position);
		var frame_partial = frame_position - frame_top;
		var frame_count = 2;	// number of frames to render (1 @ 100%-200%, 1 @ 50%-100%)
		var base_scale = Math.pow(2.0, frame_partial);

//		console.log('render position', frame_position, frame_top, frame_partial);

		// determine how many extra frames we must render
		// so that the canvas corners are covered by bitmaps
		var cx = this.canvas.width() * 0.5;				// canvas center point
		var cy = this.canvas.height() * 0.5;

		var rx = Math.cos(this.frame_rotation * 2 * Math.PI);	// rotation vector
		var ry = Math.sin(this.frame_rotation * 2 * Math.PI);

		// search for extra frames; we start with the current
		// full-size frame in case it satisfies the full-coverage
		// requirement, and we cap at 2 extra frames (meaning we
		// would be magnifying it 4x on each axis, which is ugly;
		// use larger keyframe images)
		base_scale *= 0.5;
		rx /= base_scale;
		ry /= base_scale;

		var extra_frames = 0;
		for (extra_frames = 0; extra_frames < 2; extra_frames++)
		{
			// scale up the initial image (this is why we pre-scale
			// down above, since we always do at least one iteration)
			base_scale *= 2.0;
			rx *= 0.5;
			ry *= 0.5;

//			console.log('extra frame', extra_frames);
//			console.log('  testing base scale', base_scale);
//			console.log('  rotation vector', rx, ry);

			// before we check the corner points, it's possible
			// this is the last available frame; if so, don't
			// bother testing another one, this is it
			if (frame_top-extra_frames == 0)
				break;

			// compute corners for each frame because the
			// keyframe images can be different sizes
			var image = this.images[frame_top-extra_frames][0];
			var ulx = image.width * 0.5 + (-cx*rx - cy*ry);		// upper left corner
			var uly = image.height * 0.5 + (-cx*ry + cy*rx);
			var urx = image.width * 0.5 + (cx*rx - cy*ry);		// upper right corner
			var ury = image.height * 0.5 + (cx*ry + cy*rx);

//			console.log('  image dimensions', image.width, 'x', image.height);
//			console.log('  upper left canvas', ulx, uly);
//			console.log('  upper right canvas', urx, ury);

			if (ulx >= 0 && ulx < image.width && uly >= 0 && uly < image.height &&
				urx >= 0 && urx < image.width && ury >= 0 && ury < image.height)
			{
				// both corners are within bounds of the image,
				// so this is enough
				break;
			}
		}

		frame_top -= extra_frames;
		frame_count += extra_frames;

		// flush any image memory contexts we're not going
		// to use
		for (i = 0; i < this.images.length; i++)
			if ((i < frame_top || i >= frame_top+frame_count) && this.images[i][2] != null)
				this.images[i][2] = null;

		// set the overall rotation
		this.context.save();
		this.context.translate(cx,cy);
		this.context.rotate(-this.frame_rotation * 2 * Math.PI);

		// draw the frames

//		console.log(this.frame_position, frame_top, cx, cy, base_scale);

		for (i = frame_top; i < frame_top+frame_count; i++)
		{
			if (i >= this.images.length)				// past the end of our animation frames (stop)
				break;
			if (!this.images[i][1])						// image isn't currently loaded (skip)
			{
				base_scale *= 0.5;
				continue;
			}

			var image = this.images[i][0];
			var iw = image.width * base_scale;			// image dimensions, scaled appropriately
			var ih = image.height * base_scale;

			// we want a memory context for this image; if we
			// haven't created one yet
			if (this.images[i][2] == null)
			{
				var temp_canvas = document.createElement('canvas');
				temp_canvas.width = image.width;
				temp_canvas.height = image.height;
				var temp_context = temp_canvas.getContext('2d');
				temp_context.drawImage(image, 0, 0);
				this.images[i][2] = temp_canvas;
			}

//			console.log('   ', i, iw, ih);
			this.context.drawImage(this.images[i][2], -iw*0.5, -ih*0.5, iw, ih);	// center is set by translate
			base_scale *= 0.5;
		}

		// make sure to restore the context so as to
		// undo the rotation/translation
		this.context.restore();

		// check for a render callback
		if (typeof(this.opts.onrender) == 'function')
			this.opts.onrender(100.0 * frame_position / (this.images.length-1));
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

				// placeholder event handler to stop/start animation
				container.on('click.whoosh', function(e) {
					e.preventDefault();
					e.stopPropagation();
					player.pause();
				});
			});
		}
	});
})(jQuery, window);

// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
// http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating

// requestAnimationFrame polyfill by Erik Möller. fixes from Paul Irish and Tino Zijdel

// MIT license

(function() {
    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame']
                                   || window[vendors[x]+'CancelRequestAnimationFrame'];
    }

    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function(callback, element) {
            var currTime = new Date().getTime();
            var timeToCall = Math.max(0, 16 - (currTime - lastTime));
            var id = window.setTimeout(function() { callback(currTime + timeToCall); },
              timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };

    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
}());
